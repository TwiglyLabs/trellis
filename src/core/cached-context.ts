import { join } from 'path';
import { loadConfig } from './scanner.ts';
import { buildGraph } from './graph.ts';
import { createContext, mergeWithRemote, attachCompleteness, resolveFromCacheOnly } from './context.ts';
import { ensureCacheDir } from './cache.ts';
import { ContextStore } from './store.ts';
import type { TrellisContext, CreateContextOptions } from './context.ts';

export interface CachedContextOptions extends CreateContextOptions {
  noCache?: boolean;
}

export interface CachedContextResult {
  ctx: TrellisContext;
  persist(): Promise<void>;
}

/**
 * Create a TrellisContext with mtime-validated caching.
 *
 * On warm cache (plan files unchanged), skips scanPlans() and buildGraph(),
 * returning the cached context in ~30ms vs ~160ms for a full scan.
 *
 * Falls back to full createContext() when:
 * - noCache is true (--no-cache flag)
 * - Cache is missing or corrupted
 * - Plan files have changed (automatic rescan of stale repos only)
 */
export function createCachedContext(
  projectDir: string,
  options?: CachedContextOptions,
): CachedContextResult {
  if (options?.noCache) {
    const ctx = createContext(projectDir, { offline: options.offline });
    return { ctx, persist: async () => {} };
  }

  let cacheDir: string;
  try {
    cacheDir = ensureCacheDir(projectDir);
  } catch {
    // Can't create cache dir (e.g., legacy .trellis file format) — fall back to uncached
    const ctx = createContext(projectDir, { offline: options?.offline });
    return { ctx, persist: async () => {} };
  }

  const config = loadConfig(projectDir);
  const plansDir = join(projectDir, config.plans_dir);

  const store = new ContextStore({
    repos: [{ path: projectDir, alias: config.project }],
    cacheDir,
    qualifyIds: false,
  });

  const multi = store.load();

  // Resolve remote plans from cache only (never fetch in cached mode).
  // The trellis sync command handles fetching.
  const { remotePlans, manifest } = config.manifest
    ? resolveFromCacheOnly(projectDir, config)
    : { remotePlans: [] as import('./types.ts').Plan[], manifest: undefined };

  let plans = multi.plans;
  let graph = multi.graph;

  if (remotePlans.length > 0) {
    plans = mergeWithRemote(plans, remotePlans, config.project);
    attachCompleteness(plans, config);
    graph = buildGraph(plans);
  }

  const ctx: TrellisContext = { projectDir, config, plansDir, plans, graph, manifest };

  return {
    ctx,
    persist: () => store.persist(),
  };
}
