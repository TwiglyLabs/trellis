import { existsSync, readFileSync } from 'fs';
import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { loadConfig, loadConfigAsync } from './scanner.ts';
import { buildGraph } from './graph.ts';
import { createContext, createContextAsync, mergeWithRemote, attachCompleteness, resolveFromCacheOnly } from './context.ts';
import { ensureCacheDir } from './cache.ts';
import { ContextStore } from './store.ts';
import { resolveProjectRepos, resolveProjectReposAsync, expandTilde } from './manifest.ts';
import { applyWorktreeOverride, applyWorktreeOverrideAsync } from './worktree.ts';
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
  const config = loadConfig(projectDir);
  const plansDir = join(projectDir, config.plans_dir);

  // Detect project mode BEFORE noCache short-circuit so --no-cache doesn't bypass it
  let projectManifestPath: string | undefined;
  if (config.project_root) {
    const projectRoot = expandTilde(config.project_root);
    const candidate = join(projectRoot, '.trellis-project');
    if (existsSync(candidate)) projectManifestPath = candidate;
  }
  if (!projectManifestPath && config.manifest) {
    const candidate = join(projectDir, '.trellis-project');
    if (existsSync(candidate)) projectManifestPath = candidate;
  }

  if (options?.noCache) {
    if (projectManifestPath) {
      // Project mode: still need createProjectContext for multi-repo scanning, but skip cache persistence
      let cacheDir: string;
      try {
        cacheDir = ensureCacheDir(projectDir);
      } catch {
        const ctx = createContext(projectDir, { offline: options.offline });
        return { ctx, persist: async () => {} };
      }
      const result = createProjectContext(projectDir, config, plansDir, projectManifestPath, cacheDir);
      return { ctx: result.ctx, persist: async () => {} };
    }
    // createContext re-reads config (minor duplication), but also handles remote plan resolution
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

  // Project mode via project_root or manifest + .trellis-project
  if (projectManifestPath) {
    return createProjectContext(projectDir, config, plansDir, projectManifestPath, cacheDir);
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

  const ctx: TrellisContext = { projectDir, config, plansDir, plans, graph, manifest, isProjectMode: false };

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
  const rawResolved = resolveProjectRepos(manifestPath);
  const resolved = applyWorktreeOverride(rawResolved, projectDir);
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
    const ctx: TrellisContext = { projectDir, config, plansDir, plans: multi.plans, graph: multi.graph, isProjectMode: false };
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
    isProjectMode: true,
  };

  return {
    ctx,
    persist: () => store.persist(),
  };
}

/**
 * Async variant of createCachedContext. Uses non-blocking I/O throughout.
 */
export async function createCachedContextAsync(
  projectDir: string,
  options?: CachedContextOptions,
): Promise<CachedContextResult> {
  const config = await loadConfigAsync(projectDir);
  const plansDir = join(projectDir, config.plans_dir);

  let projectManifestPath: string | undefined;
  if (config.project_root) {
    const projectRoot = expandTilde(config.project_root);
    const candidate = join(projectRoot, '.trellis-project');
    try { await access(candidate); projectManifestPath = candidate; } catch { /* not found */ }
  }
  if (!projectManifestPath && config.manifest) {
    const candidate = join(projectDir, '.trellis-project');
    try { await access(candidate); projectManifestPath = candidate; } catch { /* not found */ }
  }

  if (options?.noCache) {
    if (projectManifestPath) {
      let cacheDir: string;
      try {
        cacheDir = ensureCacheDir(projectDir);
      } catch {
        const ctx = await createContextAsync(projectDir, { offline: options.offline });
        return { ctx, persist: async () => {} };
      }
      const result = await createProjectContextAsync(projectDir, config, plansDir, projectManifestPath, cacheDir);
      return { ctx: result.ctx, persist: async () => {} };
    }
    const ctx = await createContextAsync(projectDir, { offline: options.offline });
    return { ctx, persist: async () => {} };
  }

  let cacheDir: string;
  try {
    cacheDir = ensureCacheDir(projectDir);
  } catch {
    const ctx = await createContextAsync(projectDir, { offline: options?.offline });
    return { ctx, persist: async () => {} };
  }

  if (projectManifestPath) {
    return createProjectContextAsync(projectDir, config, plansDir, projectManifestPath, cacheDir);
  }

  const store = new ContextStore({
    repos: [{ path: projectDir, alias: config.project }],
    cacheDir,
    qualifyIds: false,
  });

  const multi = await store.loadAsync();

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

  const ctx: TrellisContext = { projectDir, config, plansDir, plans, graph, manifest, isProjectMode: false };

  return {
    ctx,
    persist: () => store.persist(),
  };
}

async function createProjectContextAsync(
  projectDir: string,
  config: import('./types.ts').TrellisConfig,
  plansDir: string,
  manifestPath: string,
  cacheDir: string,
): Promise<CachedContextResult> {
  const rawResolved = await resolveProjectReposAsync(manifestPath);
  const resolved = await applyWorktreeOverrideAsync(rawResolved, projectDir);
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
    process.stderr.write(`[trellis] warning: all repos in manifest have missing paths, falling back to single-repo mode\n`);
    const store = new ContextStore({
      repos: [{ path: projectDir, alias: config.project }],
      cacheDir,
      qualifyIds: false,
    });
    const multi = await store.loadAsync();
    const ctx: TrellisContext = { projectDir, config, plansDir, plans: multi.plans, graph: multi.graph, isProjectMode: false };
    return { ctx, persist: () => store.persist() };
  }

  let manifest: ProjectManifest | undefined;
  try {
    const content = await readFile(manifestPath, 'utf8');
    manifest = parseManifest(content);
  } catch {
    // Non-fatal
  }

  const store = new ContextStore({ repos: specs, cacheDir, qualifyIds: true });
  const multi = await store.loadAsync();

  const ctx: TrellisContext = {
    projectDir,
    config,
    plansDir,
    plans: multi.plans,
    graph: multi.graph,
    manifest,
    isProjectMode: true,
  };

  return {
    ctx,
    persist: () => store.persist(),
  };
}
