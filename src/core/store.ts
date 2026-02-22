import { join, relative } from 'path';
import {
  existsSync, statSync, readdirSync, readFileSync, writeFileSync,
  mkdirSync, renameSync, unlinkSync,
} from 'fs';
import { readdir, stat as statAsync, access } from 'fs/promises';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { scanPlans, loadConfig, scanPlansAsync, loadConfigAsync } from './scanner.ts';
import { buildGraph, patchGraph } from './graph.ts';
import { attachCompleteness } from './context.ts';
import { computeCompleteness } from './completeness.ts';
import { createFileLock } from './mutex.ts';
import { watchMultiRepo } from '../features/watch/logic.ts';
import type { Plan, TrellisConfig, RepoSpec, MultiRepoEntry, PlanIndex, RepoIndexEntry } from './types.ts';
import type { MultiContext } from './context.ts';
import type { GraphData } from './graph.ts';
import type { PlanChangeBatch, PlanChangeEvent, WatchHandle } from '../features/watch/types.ts';

const INDEX_VERSION = 1;
const INDEX_FILENAME = 'context-store.json';

/**
 * Compute a composite hash from all plan file mtimes under a plans directory.
 * Does stat() only — no file reads. Returns a deterministic hex string.
 *
 * Handles:
 * - Empty directory → stable empty hash
 * - Missing directory → null
 */
export function computeMtimeHash(plansDir: string): string | null {
  if (!existsSync(plansDir)) return null;

  const entries: string[] = [];
  collectPlanMtimes(plansDir, plansDir, entries);
  entries.sort(); // deterministic order

  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(entry);
  }
  return hash.digest('hex').slice(0, 32);
}

function collectPlanMtimes(baseDir: string, dir: string, entries: string[]): void {
  let items: string[];
  try {
    items = readdirSync(dir);
  } catch {
    return;
  }

  for (const item of items) {
    const fullPath = join(dir, item);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      collectPlanMtimes(baseDir, fullPath, entries);
    } else if (isPlanFile(item)) {
      const relPath = relative(baseDir, fullPath);
      entries.push(`${relPath}:${stat.mtimeMs}`);
    }
  }
}

async function collectPlanMtimesAsync(baseDir: string, dir: string, entries: string[]): Promise<void> {
  let items: string[];
  try {
    items = await readdir(dir);
  } catch {
    return;
  }

  for (const item of items) {
    const fullPath = join(dir, item);
    let fileStat;
    try {
      fileStat = await statAsync(fullPath);
    } catch {
      continue;
    }

    if (fileStat.isDirectory()) {
      await collectPlanMtimesAsync(baseDir, fullPath, entries);
    } else if (isPlanFile(item)) {
      const relPath = relative(baseDir, fullPath);
      entries.push(`${relPath}:${fileStat.mtimeMs}`);
    }
  }
}

export async function computeMtimeHashAsync(plansDir: string): Promise<string | null> {
  try {
    await access(plansDir);
  } catch {
    return null;
  }

  const entries: string[] = [];
  await collectPlanMtimesAsync(plansDir, plansDir, entries);
  entries.sort();

  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(entry);
  }
  return hash.digest('hex').slice(0, 32);
}

function isPlanFile(filename: string): boolean {
  return filename === 'README.md' ||
    filename === 'implementation.md' ||
    filename === 'inputs.md' ||
    filename === 'outputs.md';
}

/**
 * Qualify a plan's ID and deps with its repo alias.
 * Matches the logic in context.ts createMultiContext.
 */
function qualifyPlan(plan: Plan, alias: string): Plan {
  const qualifiedId = `${alias}:${plan.id}`;
  const deps = plan.frontmatter.depends_on;
  const qualifiedDeps = deps?.map(dep =>
    dep.indexOf(':') !== -1 ? dep : `${alias}:${dep}`
  );

  return {
    ...plan,
    id: qualifiedId,
    repoAlias: alias,
    frontmatter: {
      ...plan.frontmatter,
      depends_on: qualifiedDeps,
    },
  };
}

export interface ContextStoreOptions {
  repos: RepoSpec[];
  cacheDir: string;
  /** When false, plan IDs are not qualified with repo aliases. Default: true. */
  qualifyIds?: boolean;
}

/**
 * Cached, mtime-validated context store for multi-repo plan management.
 *
 * Wraps createMultiContext with a persistent file-based index and mtime-based
 * invalidation. Plan files on disk are always authoritative — the index is
 * purely a cache that can be deleted and rebuilt at any time.
 */
export class ContextStore {
  private repos: RepoSpec[];
  private cacheDir: string;
  private indexPath: string;
  private qualifyIds: boolean;
  private context: MultiContext | null = null;
  private index: PlanIndex | null = null;
  private lock = createFileLock();
  private watchHandle: WatchHandle | null = null;
  private suppressedAliases = new Set<string>();

  constructor(opts: ContextStoreOptions) {
    this.repos = opts.repos;
    this.cacheDir = opts.cacheDir;
    this.indexPath = join(opts.cacheDir, INDEX_FILENAME);
    this.qualifyIds = opts.qualifyIds ?? true;
  }

  /**
   * Load or rebuild the multi-repo context.
   * Reads the index file, validates mtime per repo, rescans stale repos only.
   */
  load(): MultiContext {
    const savedIndex = this.readIndex();
    let anyStale = false;

    const allPlans: Plan[] = [];
    const repoEntries: MultiRepoEntry[] = [];

    for (const repo of this.repos) {
      const { plans, entry, stale } = this.loadRepo(repo, savedIndex);
      allPlans.push(...plans);
      repoEntries.push(entry);
      if (stale) anyStale = true;
    }

    // Prune repos from index that are no longer in the repos list
    const currentAliases = new Set(this.repos.map(r => r.alias));
    if (savedIndex) {
      for (const alias of Object.keys(savedIndex.repos)) {
        if (!currentAliases.has(alias)) {
          anyStale = true;
        }
      }
    }

    // On full cache hit with a valid graph snapshot, deserialize instead of rebuilding
    let graph: GraphData;
    if (!anyStale && savedIndex?.graphSnapshot) {
      graph = deserializeGraph(savedIndex.graphSnapshot, allPlans);
    } else {
      graph = buildGraph(allPlans);
    }
    this.context = { plans: allPlans, graph, repos: repoEntries };

    // Build index for persistence
    this.index = {
      version: INDEX_VERSION,
      repos: {},
      graphSnapshot: serializeGraph(graph),
    };

    for (const repo of this.repos) {
      const entry = repoEntries.find(e => e.alias === repo.alias)!;
      const repoPlans = this.qualifyIds
        ? allPlans.filter(p => p.repoAlias === repo.alias)
        : allPlans.filter(p => !p.repoAlias || p.repoAlias === repo.alias);
      const plansDir = entry.plansDir ?? join(repo.path, 'plans');
      const configMtime = getConfigMtime(repo.path);

      this.index.repos[repo.alias] = {
        path: repo.path,
        configMtime: configMtime ?? '',
        mtimeHash: computeMtimeHash(plansDir) ?? '',
        scannedAt: new Date().toISOString(),
        plans: repoPlans,
      };
    }

    return this.context;
  }

  /**
   * Async variant of load(). Uses non-blocking I/O for scanning and mtime checks.
   */
  async loadAsync(): Promise<MultiContext> {
    const savedIndex = this.readIndex();
    let anyStale = false;

    const allPlans: Plan[] = [];
    const repoEntries: MultiRepoEntry[] = [];

    for (const repo of this.repos) {
      const { plans, entry, stale } = await this.loadRepoAsync(repo, savedIndex);
      allPlans.push(...plans);
      repoEntries.push(entry);
      if (stale) anyStale = true;
    }

    const currentAliases = new Set(this.repos.map(r => r.alias));
    if (savedIndex) {
      for (const alias of Object.keys(savedIndex.repos)) {
        if (!currentAliases.has(alias)) {
          anyStale = true;
        }
      }
    }

    let graph: GraphData;
    if (!anyStale && savedIndex?.graphSnapshot) {
      graph = deserializeGraph(savedIndex.graphSnapshot, allPlans);
    } else {
      graph = buildGraph(allPlans);
    }
    this.context = { plans: allPlans, graph, repos: repoEntries };

    this.index = {
      version: INDEX_VERSION,
      repos: {},
      graphSnapshot: serializeGraph(graph),
    };

    for (const repo of this.repos) {
      const entry = repoEntries.find(e => e.alias === repo.alias)!;
      const repoPlans = this.qualifyIds
        ? allPlans.filter(p => p.repoAlias === repo.alias)
        : allPlans.filter(p => !p.repoAlias || p.repoAlias === repo.alias);
      const plansDir = entry.plansDir ?? join(repo.path, 'plans');
      const configMtime = await getConfigMtimeAsync(repo.path);

      this.index.repos[repo.alias] = {
        path: repo.path,
        configMtime: configMtime ?? '',
        mtimeHash: await computeMtimeHashAsync(plansDir) ?? '',
        scannedAt: new Date().toISOString(),
        plans: repoPlans,
      };
    }

    return this.context;
  }

  /**
   * Return the cached MultiContext. Must call load() first.
   */
  get(): MultiContext {
    if (!this.context) {
      throw new Error('ContextStore.get() called before load()');
    }
    return this.context;
  }

  /**
   * Mark a repo as stale, rescan it, and rebuild the graph incrementally.
   */
  invalidate(alias: string): void {
    if (!this.context) {
      throw new Error('ContextStore.invalidate() called before load()');
    }

    const repo = this.repos.find(r => r.alias === alias);
    if (!repo) return;

    const entry = this.context.repos.find(r => r.alias === alias);
    if (!entry) return;

    // Suppress echo from watch for this alias
    this.suppressedAliases.add(alias);
    setTimeout(() => this.suppressedAliases.delete(alias), 200);

    const plansDir = entry.plansDir ?? join(repo.path, 'plans');
    let config: TrellisConfig | undefined;
    try {
      config = loadConfig(repo.path);
    } catch {
      // config load failed, skip
    }

    let newPlans: Plan[] = [];
    try {
      const rawPlans = scanPlans(plansDir);
      if (config) attachCompleteness(rawPlans, config);
      newPlans = this.qualifyIds
        ? rawPlans.map(p => qualifyPlan(p, alias))
        : rawPlans;
    } catch {
      // scan failed — use empty plans
    }

    // Build PlanChangeEvents for patchGraph from the diff
    const oldPlans = this.qualifyIds
      ? this.context.plans.filter(p => p.repoAlias === alias)
      : this.context.plans; // single-repo: all plans belong to the only repo
    const events = diffPlansToEvents(oldPlans, newPlans);

    // Apply incremental graph update
    const graph = patchGraph(this.context.graph, events);

    // Derive plans from graph (single source of truth)
    const allPlans = Array.from(graph.plans.values());

    // Update entry
    const newEntry: MultiRepoEntry = {
      ...entry,
      planCount: newPlans.length,
      ...(config ? { config } : {}),
    };

    const newRepos = this.context.repos.map(r => r.alias === alias ? newEntry : r);

    this.context = { plans: allPlans, graph, repos: newRepos };

    // Update index for this repo
    if (this.index) {
      const configMtime = getConfigMtime(repo.path);
      this.index.repos[alias] = {
        path: repo.path,
        configMtime: configMtime ?? '',
        mtimeHash: computeMtimeHash(plansDir) ?? '',
        scannedAt: new Date().toISOString(),
        plans: newPlans,
      };
      this.index.graphSnapshot = serializeGraph(graph);
    }
  }

  /**
   * Write the index to disk atomically (temp file + rename).
   * Guarded by a file lock for concurrent access protection.
   */
  async persist(): Promise<void> {
    if (!this.index) return;

    await this.lock('context-store-persist', () => {
      if (!this.index) return;

      try {
        mkdirSync(this.cacheDir, { recursive: true });

        const serialized = JSON.stringify(this.index, dateReplacer, 2);
        const tmpPath = join(this.cacheDir, `.context-store-${Date.now()}.tmp`);

        writeFileSync(tmpPath, serialized, 'utf8');
        renameSync(tmpPath, this.indexPath);
      } catch {
        // persist failure is non-fatal — next invocation does full scan
      }
    });
  }

  /**
   * Start watching all repos for plan file changes.
   * Pipes PlanChangeBatch through applyBatch + patchGraph for incremental updates.
   */
  watch(onChange?: (ctx: MultiContext) => void): WatchHandle {
    if (!this.context) {
      throw new Error('ContextStore.watch() called before load()');
    }

    const watchableRepos = this.context.repos
      .filter(r => r.plansDir && existsSync(r.plansDir))
      .map(r => ({ alias: r.alias, plansDir: r.plansDir! }));

    if (watchableRepos.length === 0) {
      return { close() {} };
    }

    this.watchHandle = watchMultiRepo(watchableRepos, (batch) => {
      if (!this.context) return;

      // Echo suppression: skip events for repos that were just invalidated
      // (must happen before ID normalization since it relies on qualified IDs)
      const filteredEvents = batch.events.filter(event => {
        const colonIdx = event.planId.indexOf(':');
        if (colonIdx === -1) return true;
        const alias = event.planId.substring(0, colonIdx);
        return !this.suppressedAliases.has(alias);
      });

      if (filteredEvents.length === 0) return;

      // Normalize event IDs to match the graph's ID scheme.
      // watchMultiRepo always qualifies planIds (alias:localId), but the graph
      // uses unqualified IDs in single-repo mode and qualified IDs in multi-repo mode.
      let normalizedEvents: PlanChangeEvent[];
      if (!this.qualifyIds) {
        // Single-repo mode: strip alias prefix so IDs match unqualified graph keys
        normalizedEvents = filteredEvents.map(event => {
          const colonIdx = event.planId.indexOf(':');
          if (colonIdx === -1) return event;
          const localId = event.planId.substring(colonIdx + 1);
          return { ...event, planId: localId };
        });
      } else {
        // Multi-repo mode: qualify plan objects so plan.id matches the qualified graph key
        normalizedEvents = filteredEvents.map(event => {
          if (event.type === 'plan-removed') return event;
          const colonIdx = event.planId.indexOf(':');
          if (colonIdx === -1) return event;
          const alias = event.planId.substring(0, colonIdx);
          return { ...event, plan: qualifyPlan(event.plan, alias) };
        });
      }

      // Apply incremental graph update directly (not via applyBatch)
      // to support per-repo config for completeness scoring
      const newGraph = patchGraph(this.context!.graph, normalizedEvents);

      // Attach completeness using per-repo config
      for (const event of normalizedEvents) {
        if (event.type === 'plan-removed') continue;
        const plan = newGraph.plans.get(event.planId);
        if (!plan) continue;

        // Look up the config for this plan's repo
        const colonIdx = event.planId.indexOf(':');
        const eventAlias = colonIdx !== -1 ? event.planId.substring(0, colonIdx) : undefined;
        const repoEntry = eventAlias
          ? this.context!.repos.find(r => r.alias === eventAlias)
          : this.context!.repos.find(r => r.config);
        if (repoEntry?.config) {
          plan.completeness = computeCompleteness(plan, repoEntry.config);
        }
      }

      const plans = Array.from(newGraph.plans.values());
      this.context = {
        plans,
        graph: newGraph,
        repos: this.context!.repos,
      };

      onChange?.(this.context);
    });

    return {
      close: () => {
        this.watchHandle?.close();
        this.watchHandle = null;
      },
    };
  }

  // --- Private helpers ---

  private readIndex(): PlanIndex | null {
    if (!existsSync(this.indexPath)) return null;

    try {
      const raw = readFileSync(this.indexPath, 'utf8');
      const parsed = JSON.parse(raw, dateReviver) as PlanIndex;

      if (parsed.version !== INDEX_VERSION) {
        return null; // version mismatch → full rebuild
      }

      return parsed;
    } catch {
      // corrupted index → full rebuild
      return null;
    }
  }

  private loadRepo(
    repo: RepoSpec,
    savedIndex: PlanIndex | null,
  ): { plans: Plan[]; entry: MultiRepoEntry; stale: boolean } {
    let configFound = false;
    let plans: Plan[] = [];
    let error: string | undefined;
    let resolvedPlansDir: string | undefined;
    let config: TrellisConfig | undefined;

    try {
      configFound = existsSync(join(repo.path, '.trellis'));
      config = loadConfig(repo.path);
      resolvedPlansDir = join(repo.path, config.plans_dir);
    } catch (e: any) {
      error = e.message;
    }

    const cached = savedIndex?.repos[repo.alias];
    let stale = true;

    if (cached && resolvedPlansDir && !error) {
      // Check config mtime
      const currentConfigMtime = getConfigMtime(repo.path);
      if (currentConfigMtime === cached.configMtime) {
        // Check plan file mtimes
        const currentMtimeHash = computeMtimeHash(resolvedPlansDir);
        if (currentMtimeHash === cached.mtimeHash) {
          // Cache hit — use cached plans
          plans = cached.plans.map(p => revivePlan(p));
          if (config) attachCompleteness(plans, config);
          stale = false;
        }
      }
    }

    if (stale && resolvedPlansDir && !error) {
      // Cache miss — full rescan
      try {
        const rawPlans = scanPlans(resolvedPlansDir);
        if (config) attachCompleteness(rawPlans, config);
        plans = this.qualifyIds
          ? rawPlans.map(p => qualifyPlan(p, repo.alias))
          : rawPlans;
      } catch (e: any) {
        error = e.message;
        plans = [];
      }
    } else if (!stale) {
      // Plans from cache — ensure consistent qualification
      if (this.qualifyIds) {
        plans = plans.map(p => {
          if (!p.id.startsWith(`${repo.alias}:`)) {
            return qualifyPlan(p, repo.alias);
          }
          return p;
        });
      }
    }

    const entry: MultiRepoEntry = {
      alias: repo.alias,
      path: repo.path,
      planCount: plans.length,
      configFound,
      ...(resolvedPlansDir ? { plansDir: resolvedPlansDir } : {}),
      ...(config ? { config } : {}),
      ...(error ? { error } : {}),
    };

    return { plans, entry, stale };
  }

  private async loadRepoAsync(
    repo: RepoSpec,
    savedIndex: PlanIndex | null,
  ): Promise<{ plans: Plan[]; entry: MultiRepoEntry; stale: boolean }> {
    let configFound = false;
    let plans: Plan[] = [];
    let error: string | undefined;
    let resolvedPlansDir: string | undefined;
    let config: TrellisConfig | undefined;

    try {
      await access(join(repo.path, '.trellis'));
      configFound = true;
    } catch {
      // no .trellis
    }
    try {
      config = await loadConfigAsync(repo.path);
      resolvedPlansDir = join(repo.path, config.plans_dir);
    } catch (e: any) {
      error = e.message;
    }

    const cached = savedIndex?.repos[repo.alias];
    let stale = true;

    if (cached && resolvedPlansDir && !error) {
      const currentConfigMtime = await getConfigMtimeAsync(repo.path);
      if (currentConfigMtime === cached.configMtime) {
        const currentMtimeHash = await computeMtimeHashAsync(resolvedPlansDir);
        if (currentMtimeHash === cached.mtimeHash) {
          plans = cached.plans.map(p => revivePlan(p));
          if (config) attachCompleteness(plans, config);
          stale = false;
        }
      }
    }

    if (stale && resolvedPlansDir && !error) {
      try {
        const rawPlans = await scanPlansAsync(resolvedPlansDir);
        if (config) attachCompleteness(rawPlans, config);
        plans = this.qualifyIds
          ? rawPlans.map(p => qualifyPlan(p, repo.alias))
          : rawPlans;
      } catch (e: any) {
        error = e.message;
        plans = [];
      }
    } else if (!stale) {
      if (this.qualifyIds) {
        plans = plans.map(p => {
          if (!p.id.startsWith(`${repo.alias}:`)) {
            return qualifyPlan(p, repo.alias);
          }
          return p;
        });
      }
    }

    const entry: MultiRepoEntry = {
      alias: repo.alias,
      path: repo.path,
      planCount: plans.length,
      configFound,
      ...(resolvedPlansDir ? { plansDir: resolvedPlansDir } : {}),
      ...(config ? { config } : {}),
      ...(error ? { error } : {}),
    };

    return { plans, entry, stale };
  }
}

// --- Diff helpers ---

/**
 * Compute PlanChangeEvents from old vs new plan lists for a repo.
 * Used by invalidate() to feed patchGraph() instead of full buildGraph().
 */
function diffPlansToEvents(oldPlans: Plan[], newPlans: Plan[]): PlanChangeEvent[] {
  const events: PlanChangeEvent[] = [];
  const oldById = new Map(oldPlans.map(p => [p.id, p]));
  const newById = new Map(newPlans.map(p => [p.id, p]));

  // Removed plans
  for (const [id] of oldById) {
    if (!newById.has(id)) {
      events.push({ type: 'plan-removed', planId: id });
    }
  }

  // Added plans
  for (const [id, plan] of newById) {
    if (!oldById.has(id)) {
      events.push({ type: 'plan-added', planId: id, plan });
    }
  }

  // Updated plans (exist in both — treat as updated)
  for (const [id, plan] of newById) {
    if (oldById.has(id)) {
      events.push({ type: 'plan-updated', planId: id, file: 'readme', plan });
    }
  }

  return events;
}

// --- Serialization helpers ---

function dateReplacer(_key: string, value: any): any {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

/**
 * JSON reviver — intentionally does NOT convert date strings during parse.
 * Date fields are handled by revivePlan() which is the single source of truth
 * for Plan date revival. This avoids accidentally converting ISO strings in
 * non-Date fields (e.g. RepoIndexEntry.scannedAt, configMtime).
 */
function dateReviver(_key: string, value: any): any {
  return value;
}

function revivePlan(raw: any): Plan {
  return {
    ...raw,
    updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt : new Date(raw.updatedAt),
  };
}

function serializeGraph(graph: GraphData): PlanIndex['graphSnapshot'] {
  const dependents: Record<string, string[]> = {};
  for (const [k, v] of graph.dependents) dependents[k] = v;

  const dependencies: Record<string, string[]> = {};
  for (const [k, v] of graph.dependencies) dependencies[k] = v;

  return {
    dependents,
    dependencies,
    blocked: [...graph.blocked],
    ready: [...graph.ready],
  };
}

function deserializeGraph(
  snapshot: NonNullable<PlanIndex['graphSnapshot']>,
  plans: Plan[],
): GraphData {
  const planMap = new Map<string, Plan>();
  for (const plan of plans) planMap.set(plan.id, plan);

  const dependents = new Map<string, string[]>();
  for (const [k, v] of Object.entries(snapshot.dependents)) dependents.set(k, v);

  const dependencies = new Map<string, string[]>();
  for (const [k, v] of Object.entries(snapshot.dependencies)) dependencies.set(k, v);

  return {
    plans: planMap,
    dependents,
    dependencies,
    blocked: new Set(snapshot.blocked),
    ready: new Set(snapshot.ready),
  };
}

function getConfigMtime(repoPath: string): string | null {
  // Check directory-style config first
  const configDir = join(repoPath, '.trellis', 'config');
  if (existsSync(configDir)) {
    try {
      return statSync(configDir).mtime.toISOString();
    } catch {
      return null;
    }
  }

  // Fall back to file-style config
  const configFile = join(repoPath, '.trellis');
  if (existsSync(configFile)) {
    try {
      const stat = statSync(configFile);
      if (stat.isFile()) {
        return stat.mtime.toISOString();
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function getConfigMtimeAsync(repoPath: string): Promise<string | null> {
  const configDir = join(repoPath, '.trellis', 'config');
  try {
    const s = await statAsync(configDir);
    return s.mtime.toISOString();
  } catch {
    // fall through
  }

  const configFile = join(repoPath, '.trellis');
  try {
    const s = await statAsync(configFile);
    if (s.isFile()) {
      return s.mtime.toISOString();
    }
  } catch {
    // fall through
  }

  return null;
}
