import { join } from 'path';
import { existsSync } from 'fs';
import { loadConfig, scanPlans } from './scanner.ts';
import { buildGraph, patchGraph } from './graph.ts';
import { computeCompleteness } from './completeness.ts';
import { readCache, writeCache, isCacheStale } from './cache.ts';
import { discoverManifest, fetchRepoPlans } from './manifest.ts';
import type { Plan, TrellisConfig, ProjectManifest, RepoSpec, MultiRepoEntry } from './types.ts';
import type { GraphData } from './graph.ts';
import type { PlanChangeBatch } from '../features/watch/types.ts';

export interface TrellisContext {
  readonly projectDir: string;
  readonly config: TrellisConfig;
  readonly plansDir: string;
  readonly plans: Plan[];
  readonly graph: GraphData;
  readonly manifest?: ProjectManifest;
  readonly isProjectMode: boolean;
}

export interface CreateContextOptions {
  offline?: boolean;
}

/**
 * Merge local plans with remote plans into a unified plan array.
 * Remote plans get qualified IDs (`repoAlias:originalId`).
 * Intra-repo deps within remote plans get qualified with their repo alias.
 * Already-qualified cross-repo deps are preserved as-is.
 */
export function mergeWithRemote(localPlans: Plan[], remotePlans: Plan[], localAlias?: string): Plan[] {
  const merged: Plan[] = [...localPlans];

  for (const plan of remotePlans) {
    const alias = plan.repoAlias!;
    const qualifiedId = `${alias}:${plan.id}`;

    // Qualify intra-repo deps: unqualified depends_on entries within a remote plan
    // reference plans in that same repo, not local plans.
    // If a qualified dep references the local project, strip the alias so it
    // resolves to the local plan's unqualified ID.
    const qualifiedDeps = (plan.frontmatter.depends_on ?? []).map(dep => {
      if (dep.indexOf(':') !== -1) {
        // Already qualified — check if it points to local project
        if (localAlias) {
          const colonIdx = dep.indexOf(':');
          const depRepo = dep.substring(0, colonIdx);
          if (depRepo === localAlias) {
            return dep.substring(colonIdx + 1); // strip to local unqualified ID
          }
        }
        return dep;
      }
      return `${alias}:${dep}`;
    });

    merged.push({
      ...plan,
      id: qualifiedId,
      frontmatter: {
        ...plan.frontmatter,
        depends_on: qualifiedDeps.length > 0 ? qualifiedDeps : plan.frontmatter.depends_on,
      },
    });
  }

  return merged;
}

/**
 * Resolve remote plans from cache (or fetch if stale).
 * Returns the remote plans and resolved manifest, or empty if no manifest configured.
 */
function resolveRemotePlans(
  projectDir: string,
  config: TrellisConfig,
  options?: CreateContextOptions,
): { remotePlans: Plan[]; manifest?: ProjectManifest } {
  if (!config.manifest || options?.offline) {
    // No manifest or offline mode: try cache only
    if (config.manifest && options?.offline) {
      return resolveFromCacheOnly(projectDir, config);
    }
    return { remotePlans: [] };
  }

  // Resolve manifest (cache or fetch)
  let manifest: ProjectManifest | null = null;
  const cachedManifest = readCache<ProjectManifest>(projectDir, 'manifest');
  if (cachedManifest && !isCacheStale(cachedManifest)) {
    manifest = cachedManifest.data;
  } else {
    manifest = discoverManifest(config.manifest, projectDir);
    if (manifest) {
      writeCache(projectDir, 'manifest', manifest);
    }
  }

  if (!manifest) return { remotePlans: [] };

  // Fetch plans per repo (cache or git fetch)
  const remotePlans: Plan[] = [];
  for (const [alias, entry] of Object.entries(manifest.repos)) {
    if (alias === config.project) continue; // skip self

    const cacheKey = `plans/${alias}`;
    const cached = readCache<Plan[]>(projectDir, cacheKey);
    if (cached && !isCacheStale(cached)) {
      remotePlans.push(...cached.data);
    } else {
      const result = fetchRepoPlans(alias, entry, projectDir);
      if (result.plans.length > 0) {
        writeCache(projectDir, cacheKey, result.plans);
      }
      remotePlans.push(...result.plans);
    }
  }

  return { remotePlans, manifest };
}

/** Offline mode: use only cached data, degrade silently if empty. */
export function resolveFromCacheOnly(
  projectDir: string,
  config: TrellisConfig,
): { remotePlans: Plan[]; manifest?: ProjectManifest } {
  const cachedManifest = readCache<ProjectManifest>(projectDir, 'manifest');
  if (!cachedManifest) return { remotePlans: [] };

  const manifest = cachedManifest.data;
  const remotePlans: Plan[] = [];

  for (const alias of Object.keys(manifest.repos)) {
    if (alias === config.project) continue;

    const cached = readCache<Plan[]>(projectDir, `plans/${alias}`);
    if (cached) {
      remotePlans.push(...cached.data);
    }
  }

  return { remotePlans, manifest };
}

/** Attach completeness scores to all plans (mutates in place). */
export function attachCompleteness(plans: Plan[], config: TrellisConfig): void {
  for (const plan of plans) {
    plan.completeness = computeCompleteness(plan, config);
  }
}

/** Build a full TrellisContext from a project directory. */
export function createContext(projectDir: string, options?: CreateContextOptions): TrellisContext {
  const config = loadConfig(projectDir);
  const plansDir = join(projectDir, config.plans_dir);
  const localPlans = scanPlans(plansDir);

  const { remotePlans, manifest } = resolveRemotePlans(projectDir, config, options);
  const plans = remotePlans.length > 0 ? mergeWithRemote(localPlans, remotePlans, config.project) : localPlans;
  attachCompleteness(plans, config);
  const graph = buildGraph(plans);

  return { projectDir, config, plansDir, plans, graph, manifest, isProjectMode: false };
}

/** Re-scan plans and rebuild the graph, preserving config. */
export function refreshContext(ctx: TrellisContext, options?: CreateContextOptions): TrellisContext {
  const localPlans = scanPlans(ctx.plansDir);

  const { remotePlans, manifest } = resolveRemotePlans(ctx.projectDir, ctx.config, options);
  const plans = remotePlans.length > 0 ? mergeWithRemote(localPlans, remotePlans, ctx.config.project) : localPlans;
  attachCompleteness(plans, ctx.config);
  const graph = buildGraph(plans);

  return { ...ctx, plans, graph, manifest: manifest ?? ctx.manifest };
}

// --- Multi-repo context ---

export interface MultiContext {
  readonly plans: Plan[];
  readonly graph: GraphData;
  readonly repos: MultiRepoEntry[];
}

/**
 * Qualify a plan's ID and deps with its repo alias.
 * Bare IDs become `alias:id`; already-qualified deps are preserved as-is.
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

/**
 * Scan multiple local repo directories and return a unified multi-repo context.
 * All plan IDs are qualified with their repo alias (`alias:planId`).
 * Bare intra-repo deps are rewritten; already-qualified cross-repo deps are preserved.
 */
export function createMultiContext(repos: RepoSpec[]): MultiContext {
  // Validate alias uniqueness
  const aliases = repos.map(r => r.alias);
  const seen = new Set<string>();
  for (const alias of aliases) {
    if (seen.has(alias)) {
      throw new Error(`Duplicate alias "${alias}". Each repo must have a unique alias.`);
    }
    seen.add(alias);
  }

  const allPlans: Plan[] = [];
  const repoEntries: MultiRepoEntry[] = [];

  for (const repo of repos) {
    let configFound = false;
    let plans: Plan[] = [];
    let error: string | undefined;
    let resolvedPlansDir: string | undefined;

    let config: TrellisConfig | undefined;
    try {
      const configPath = join(repo.path, '.trellis');
      configFound = existsSync(configPath);
      config = loadConfig(repo.path);
      resolvedPlansDir = join(repo.path, config.plans_dir);
      plans = scanPlans(resolvedPlansDir);
    } catch (e: any) {
      error = e.message;
    }

    if (config) attachCompleteness(plans, config);
    const qualified = plans.map(p => qualifyPlan(p, repo.alias));
    allPlans.push(...qualified);

    repoEntries.push({
      alias: repo.alias,
      path: repo.path,
      planCount: plans.length,
      configFound,
      ...(resolvedPlansDir ? { plansDir: resolvedPlansDir } : {}),
      ...(config ? { config } : {}),
      ...(error ? { error } : {}),
    });
  }

  const graph = buildGraph(allPlans);

  return { plans: allPlans, graph, repos: repoEntries };
}

// --- Reactive context ---

/**
 * Apply a watch batch to an existing context, returning a new context.
 * Uses patchGraph for incremental graph updates and attaches completeness
 * scores to changed plans. This is the primary reactive primitive for UI
 * consumers: pair with watchPlans() for a complete subscribe-and-update loop.
 *
 * ```ts
 * let ctx = createContext(projectDir);
 * const handle = watchPlans(ctx.plansDir, (batch) => {
 *   ctx = applyBatch(ctx, batch);
 *   // ctx.plans, ctx.graph are now up-to-date
 * });
 * ```
 */
export function applyBatch(ctx: TrellisContext, batch: PlanChangeBatch): TrellisContext {
  if (batch.events.length === 0) return ctx;

  const newGraph = patchGraph(ctx.graph, batch.events);

  // Attach completeness to plans that were added or updated
  for (const event of batch.events) {
    if (event.type === 'plan-removed') continue;
    const plan = newGraph.plans.get(event.planId);
    if (plan) {
      plan.completeness = computeCompleteness(plan, ctx.config);
    }
  }

  // Derive plans array from the graph's Map (single source of truth)
  const plans = Array.from(newGraph.plans.values());

  return { ...ctx, plans, graph: newGraph };
}
