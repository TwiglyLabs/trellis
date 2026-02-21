import { join, relative, dirname, basename } from 'path';
import { watch as fsWatch, readFileSync, existsSync, statSync, readdirSync, type FSWatcher } from 'fs';
import { createHash } from 'crypto';
import { scanPlans, parseFrontmatter, derivePlanId, parseInputs, parseOutputs } from '../../core/index.ts';
import type { Plan, TrellisConfig } from '../../core/types.ts';
import { FILE_KIND_MAP } from './types.ts';
import type {
  PlanFileKind,
  PlanChangeEvent,
  PlanChangeBatch,
  WatchHandle,
  ResolvedPath,
} from './types.ts';

// --- Legacy interface (kept for backward compat with existing WatchableContext) ---

import { EventEmitter } from 'events';

export interface WatchableInstance extends EventEmitter {
  readonly projectDir: string;
  readonly config: TrellisConfig;
  refresh(): void;
  graph(): any;
}

export interface WatchState {
  watcher: FSWatcher | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

// --- Path resolution ---

/**
 * Resolve a raw filesystem event path to a plan ID and file kind.
 * Returns null if the path is not a recognized plan file.
 */
export function resolvePath(plansDir: string, eventPath: string): ResolvedPath | null {
  // eventPath from fs.watch is relative to the watched directory
  const parts = eventPath.split(/[/\\]/);

  // We need at least 2 parts: planId/filename (or deeper: nested/planId/filename)
  if (parts.length < 2) return null;

  const fileName = parts[parts.length - 1];
  const fileKind = FILE_KIND_MAP[fileName];
  if (!fileKind) return null;

  // Plan ID is the directory path relative to plansDir (everything except the filename)
  const planId = parts.slice(0, -1).join('/');
  const absolutePath = join(plansDir, eventPath);

  return { planId, fileKind, absolutePath };
}

// --- Content hashing ---

/** Compute a truncated SHA-256 hash of content (16 hex chars, matching scanner.ts). */
export function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Build the initial hash map for all known plan files under plansDir.
 * Keys are absolute file paths, values are 16-char hex hashes.
 */
export function buildHashMap(plansDir: string): Map<string, string> {
  const hashMap = new Map<string, string>();
  const plans = scanPlans(plansDir);
  const planFileNames = Object.keys(FILE_KIND_MAP);

  for (const plan of plans) {
    const planDir = dirname(plan.filePath);
    for (const fileName of planFileNames) {
      const filePath = join(planDir, fileName);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf8');
        hashMap.set(filePath, computeHash(content));
      }
    }
  }

  return hashMap;
}

// --- Plan scanning for a single plan directory ---

const PLAN_FILE_NAMES = ['README.md', 'implementation.md', 'inputs.md', 'outputs.md'] as const;

/**
 * Scan a single plan directory and return the Plan if valid, or null.
 * Reads only the target plan's files — no full directory walk.
 */
function scanSinglePlan(plansDir: string, planId: string): Plan | null {
  const planDir = join(plansDir, planId);
  const readmePath = join(planDir, 'README.md');

  if (!existsSync(readmePath)) return null;

  const content = readFileSync(readmePath, 'utf8');
  const result = parseFrontmatter(content);
  if (!result) return null;

  // Compute recency metadata
  const fileHashes: Record<string, string> = {};
  let maxMtime = statSync(readmePath).mtime;
  fileHashes['README.md'] = createHash('sha256').update(content).digest('hex').slice(0, 16);

  for (const fileName of PLAN_FILE_NAMES) {
    if (fileName === 'README.md') continue;
    const filePath = join(planDir, fileName);
    if (existsSync(filePath)) {
      const fileStat = statSync(filePath);
      if (fileStat.mtime > maxMtime) maxMtime = fileStat.mtime;
      const fileContent = readFileSync(filePath, 'utf8');
      fileHashes[fileName] = createHash('sha256').update(fileContent).digest('hex').slice(0, 16);
    }
  }

  const plan: Plan = {
    id: derivePlanId(readmePath, plansDir),
    filePath: readmePath,
    frontmatter: result.frontmatter,
    body: result.body,
    lineCount: content.split('\n').length,
    updatedAt: maxMtime,
    fileHashes,
  };

  // Load contracts
  const inputsPath = join(planDir, 'inputs.md');
  const outputsPath = join(planDir, 'outputs.md');
  if (existsSync(inputsPath)) {
    plan.inputs = parseInputs(readFileSync(inputsPath, 'utf8'));
  }
  if (existsSync(outputsPath)) {
    plan.outputs = parseOutputs(readFileSync(outputsPath, 'utf8'));
  }

  // Aggregate implementation.md line count
  const implPath = join(planDir, 'implementation.md');
  if (existsSync(implPath)) {
    const implContent = readFileSync(implPath, 'utf8');
    plan.lineCount += implContent.split('\n').length;
    plan.implementationContent = implContent;
  }

  return plan;
}

// --- New typed watchPlans ---

export interface WatchPlansOptions {
  debounceMs?: number;
}

/**
 * Watch a plans directory for changes and emit typed PlanChangeBatch events.
 *
 * Uses fs.watch with recursive mode, content hashing to suppress phantom rebuilds,
 * and debounced batch emission.
 */
export function watchPlans(
  plansDir: string,
  callback: (batch: PlanChangeBatch) => void,
  options?: WatchPlansOptions,
): WatchHandle;
/**
 * Legacy overload: watch using WatchableInstance + WatchState.
 */
export function watchPlans(
  instance: WatchableInstance,
  state: WatchState,
  debounceMs?: number,
): void;
export function watchPlans(
  plansDirOrInstance: string | WatchableInstance,
  callbackOrState: ((batch: PlanChangeBatch) => void) | WatchState,
  optionsOrDebounce?: WatchPlansOptions | number,
): WatchHandle | void {
  // Legacy overload detection
  if (typeof plansDirOrInstance !== 'string') {
    return watchPlansLegacy(
      plansDirOrInstance,
      callbackOrState as WatchState,
      optionsOrDebounce as number | undefined,
    );
  }

  const plansDir = plansDirOrInstance;
  const callback = callbackOrState as (batch: PlanChangeBatch) => void;
  const opts = (optionsOrDebounce as WatchPlansOptions | undefined) ?? {};
  const debounceMs = opts.debounceMs ?? 100;

  // Initialize hash map and known plan set
  const hashMap = buildHashMap(plansDir);
  const knownPlanIds = new Set<string>();
  const initialPlans = scanPlans(plansDir);
  for (const p of initialPlans) {
    knownPlanIds.add(p.id);
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingEvents: PlanChangeEvent[] = [];
  let closed = false;

  const watcher = fsWatch(plansDir, { recursive: true }, (_eventType, filename) => {
    if (closed || !filename) return;

    const resolved = resolvePath(plansDir, filename);
    if (!resolved) return;

    const { planId, fileKind, absolutePath } = resolved;

    // Check if file still exists (delete vs modify)
    const fileExists = existsSync(absolutePath);

    if (fileExists) {
      // Content hash check — suppress phantom rebuilds
      const content = readFileSync(absolutePath, 'utf8');
      const newHash = computeHash(content);
      const oldHash = hashMap.get(absolutePath);
      if (oldHash === newHash) return; // phantom rebuild — suppress
      hashMap.set(absolutePath, newHash);

      // Classify as added or updated
      const plan = scanSinglePlan(plansDir, planId);
      if (!plan) return; // not a valid plan (e.g., frontmatter parse failed)

      if (!knownPlanIds.has(planId)) {
        knownPlanIds.add(planId);
        pendingEvents.push({ type: 'plan-added', planId, plan });
      } else {
        pendingEvents.push({ type: 'plan-updated', planId, file: fileKind, plan });
      }
    } else {
      // File was removed
      hashMap.delete(absolutePath);

      if (fileKind === 'readme') {
        // README.md gone = plan removed
        if (knownPlanIds.has(planId)) {
          knownPlanIds.delete(planId);
          // Remove all hashes for this plan
          const planDir = join(plansDir, planId);
          for (const key of hashMap.keys()) {
            if (key.startsWith(planDir)) hashMap.delete(key);
          }
          pendingEvents.push({ type: 'plan-removed', planId });
        }
      } else {
        // A secondary file was removed — treat as update
        if (knownPlanIds.has(planId)) {
          const plan = scanSinglePlan(plansDir, planId);
          if (plan) {
            pendingEvents.push({ type: 'plan-updated', planId, file: fileKind, plan });
          }
        }
      }
    }

    // Reset debounce timer
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (closed || pendingEvents.length === 0) return;
      const batch: PlanChangeBatch = {
        events: [...pendingEvents],
        timestamp: new Date(),
      };
      pendingEvents = [];
      callback(batch);
    }, debounceMs);
  });

  watcher.on('error', () => {
    // Silently handle — consumer can close and reopen
  });

  return {
    close() {
      closed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      watcher.close();
    },
  };
}

// --- Legacy implementation ---

function watchPlansLegacy(instance: WatchableInstance, state: WatchState, debounceMs = 100): void {
  if (state.watcher) return;

  const plansDir = join(instance.projectDir, instance.config.plans_dir);
  state.watcher = fsWatch(plansDir, { recursive: true }, () => {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      instance.refresh();
      instance.emit('change', instance.graph());
    }, debounceMs);
  });

  state.watcher.on('error', (err) => {
    instance.emit('error', err);
  });
}

// --- unwatchPlans / isWatching (legacy) ---

export function unwatchPlans(state: WatchState): void {
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
  if (state.watcher) {
    state.watcher.close();
    state.watcher = null;
  }
}

export function isWatching(state: WatchState): boolean {
  return state.watcher !== null;
}

// --- watchMultiRepo ---

/**
 * Watch multiple repos and qualify events with repo aliases.
 * Creates one watcher per repo and aggregates events into a single callback.
 */
export function watchMultiRepo(
  repos: Array<{ alias: string; plansDir: string }>,
  callback: (batch: PlanChangeBatch) => void,
  options?: WatchPlansOptions,
): WatchHandle {
  const debounceMs = options?.debounceMs ?? 100;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingEvents: PlanChangeEvent[] = [];
  let closed = false;

  const handles: WatchHandle[] = [];

  for (const repo of repos) {
    const handle = watchPlans(repo.plansDir, (batch) => {
      if (closed) return;

      // Qualify each event's planId with the repo alias
      for (const event of batch.events) {
        const qualifiedId = `${repo.alias}:${event.planId}`;
        if (event.type === 'plan-removed') {
          pendingEvents.push({ type: 'plan-removed', planId: qualifiedId });
        } else {
          pendingEvents.push({ ...event, planId: qualifiedId });
        }
      }

      // Re-debounce at the multi-repo level
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (closed || pendingEvents.length === 0) return;
        const aggregated: PlanChangeBatch = {
          events: [...pendingEvents],
          timestamp: new Date(),
        };
        pendingEvents = [];
        callback(aggregated);
      }, debounceMs);
    }, { debounceMs: 20 }); // short inner debounce to batch per-repo fs bursts; outer handles aggregation

    handles.push(handle);
  }

  return {
    close() {
      closed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      for (const h of handles) h.close();
    },
  };
}
