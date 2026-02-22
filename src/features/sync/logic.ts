import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  parseManifest,
  type AsyncGitExecutor,
  defaultAsyncGit,
  discoverManifestAsync,
  fetchRepoPlansAsync,
} from '../../core/manifest.ts';
import { loadConfig, scanPlans } from '../../core/scanner.ts';
import { writeCache } from '../../core/cache.ts';
import type { Plan, ProjectManifest, TrellisConfig } from '../../core/types.ts';

// Re-export for backward compatibility
export type { AsyncGitExecutor } from '../../core/manifest.ts';
export { defaultAsyncGit } from '../../core/manifest.ts';

// --- Concurrency pool ---

export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// --- Manifest resolution ---

export function resolveLocalManifest(projectDir: string): ProjectManifest | null {
  const manifestPath = join(projectDir, '.trellis-project');
  if (!existsSync(manifestPath)) return null;
  try {
    const content = readFileSync(manifestPath, 'utf8');
    return parseManifest(content);
  } catch {
    return null;
  }
}

// --- Main sync logic ---

export interface RepoSyncResult {
  alias: string;
  status: 'ok' | 'error';
  plans?: Plan[];
  planCount: number;
  error?: string;
  durationMs: number;
}

export interface SyncResult {
  project: string;
  repos: RepoSyncResult[];
  totalPlans: number;
  totalRepos: number;
  successfulRepos: number;
  durationMs: number;
}

export interface ComputeSyncOptions {
  config: TrellisConfig;
  projectDir: string;
  repo?: string;
  concurrency?: number;
  git?: AsyncGitExecutor;
}

const DEFAULT_CONCURRENCY = 5;

export async function computeSync(opts: ComputeSyncOptions): Promise<SyncResult> {
  const { config, projectDir, repo: filterRepo, git = defaultAsyncGit } = opts;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const startTime = Date.now();

  // Step 1: Resolve manifest
  let manifest: ProjectManifest | null = null;

  // Try local .trellis-project first
  manifest = resolveLocalManifest(projectDir);

  // Fall back to git fetch if no local manifest
  if (!manifest && config.manifest) {
    manifest = await discoverManifestAsync(config.manifest, projectDir, git);
  }

  if (!manifest) {
    throw new Error(
      config.manifest
        ? 'Failed to discover project manifest. Check manifest URL and network access.'
        : 'No manifest configured. Add "manifest: <git-url>" to your .trellis config or create a .trellis-project file.',
    );
  }

  // Cache the manifest
  writeCache(projectDir, 'manifest', manifest);

  // Step 2: Determine repos to sync
  const repoEntries = Object.entries(manifest.repos)
    .filter(([alias]) => alias !== config.project) // skip local project
    .filter(([alias]) => !filterRepo || alias === filterRepo) // filter by --repo flag
    .filter(([, entry]) => entry.url); // skip path-only entries

  if (filterRepo && repoEntries.length === 0) {
    throw new Error(`Repo "${filterRepo}" not found in manifest.`);
  }

  if (repoEntries.length === 0) {
    return {
      project: manifest.name,
      repos: [],
      totalPlans: 0,
      totalRepos: 0,
      successfulRepos: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // Step 3: Fetch all repos in parallel with concurrency limit
  const tasks = repoEntries.map(([alias, entry]) => {
    return async (): Promise<RepoSyncResult> => {
      const repoStart = Date.now();
      try {
        const result = await fetchRepoPlansAsync(alias, entry, projectDir, git);
        if (result.fetchFailed) {
          return {
            alias,
            status: 'error',
            planCount: 0,
            error: result.error ?? `Failed to fetch plans from "${alias}"`,
            durationMs: Date.now() - repoStart,
          };
        }

        // Write to cache
        writeCache(projectDir, `plans/${alias}`, result.plans);

        return {
          alias,
          status: 'ok',
          plans: result.plans,
          planCount: result.plans.length,
          durationMs: Date.now() - repoStart,
        };
      } catch (err: any) {
        return {
          alias,
          status: 'error',
          planCount: 0,
          error: err.message ?? `Unknown error fetching "${alias}"`,
          durationMs: Date.now() - repoStart,
        };
      }
    };
  });

  const repos = await runWithConcurrency(tasks, concurrency);

  const totalPlans = repos.reduce((sum, r) => sum + r.planCount, 0);
  const successfulRepos = repos.filter(r => r.status === 'ok').length;

  return {
    project: manifest.name,
    repos,
    totalPlans,
    totalRepos: repos.length,
    successfulRepos,
    durationMs: Date.now() - startTime,
  };
}
