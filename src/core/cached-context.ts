import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadConfig } from './scanner.ts';
import { buildGraph } from './graph.ts';
import { createContext, mergeWithRemote, attachCompleteness, resolveFromCacheOnly } from './context.ts';
import { ensureCacheDir } from './cache.ts';
import { ContextStore } from './store.ts';
import { resolveProjectRepos, expandTilde } from './manifest.ts';
import { parseManifest } from './manifest.ts';
import type { TrellisContext, CreateContextOptions } from './context.ts';
import type { RepoSpec, ProjectManifest } from './types.ts';

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
 * Resolution order:
 * 1. Config has manifest + .trellis-project exists → project mode (multi-repo)
 * 2. Fallback → single-repo mode
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

  // Project mode via project_root: leaf repo pointing to meta-repo
  if (config.project_root) {
    const projectRoot = expandTilde(config.project_root);
    const manifestPath = join(projectRoot, '.trellis-project');
    if (existsSync(manifestPath)) {
      return createProjectContext(projectDir, config, plansDir, manifestPath, cacheDir);
    }
    // project_root set but .trellis-project not found — fall through to single-repo
  }

  // Project mode: config has manifest + .trellis-project exists locally (meta-repo case)
  if (config.manifest) {
    const manifestPath = join(projectDir, '.trellis-project');
    if (existsSync(manifestPath)) {
      return createProjectContext(projectDir, config, plansDir, manifestPath, cacheDir);
    }
    // manifest configured but no .trellis-project — fall through to single-repo
    // (CLI is more lenient than MCP; user can still run `trellis status` without syncing)
  }

  // Single-repo mode
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

/**
 * Build a project-mode context: resolve all repos from .trellis-project,
 * create a multi-repo ContextStore, and wrap the result in TrellisContext shape.
 */
function createProjectContext(
  projectDir: string,
  config: import('./types.ts').TrellisConfig,
  plansDir: string,
  manifestPath: string,
  cacheDir: string,
): CachedContextResult {
  const resolved = resolveProjectRepos(manifestPath);
  const specs: RepoSpec[] = [];
  const warnings: string[] = [];

  for (const repo of resolved) {
    if (!repo.exists) {
      warnings.push(`Repo "${repo.alias}" path does not exist: ${repo.localPath}`);
      continue;
    }
    specs.push({ alias: repo.alias, path: repo.localPath });
  }

  if (warnings.length > 0) {
    for (const w of warnings) {
      process.stderr.write(`[trellis] warning: ${w}\n`);
    }
  }

  if (specs.length === 0) {
    // All repos missing — fall back to single-repo mode
    process.stderr.write(`[trellis] warning: all repos in manifest have missing paths, falling back to single-repo mode\n`);
    const store = new ContextStore({
      repos: [{ path: projectDir, alias: config.project }],
      cacheDir,
      qualifyIds: false,
    });
    const multi = store.load();
    const ctx: TrellisContext = { projectDir, config, plansDir, plans: multi.plans, graph: multi.graph };
    return { ctx, persist: () => store.persist() };
  }

  // Parse manifest for TrellisContext.manifest field
  let manifest: ProjectManifest | undefined;
  try {
    manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  } catch {
    // Non-fatal — manifest object is optional in TrellisContext
  }

  const store = new ContextStore({ repos: specs, cacheDir, qualifyIds: true });
  const multi = store.load();

  const ctx: TrellisContext = {
    projectDir,
    config,
    plansDir,
    plans: multi.plans,
    graph: multi.graph,
    manifest,
  };

  return {
    ctx,
    persist: () => store.persist(),
  };
}
