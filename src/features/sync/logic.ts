import { execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseManifest } from '../../core/manifest.ts';
import { parseFrontmatter } from '../../core/frontmatter.ts';
import { loadConfig, scanPlans } from '../../core/scanner.ts';
import { writeCache } from '../../core/cache.ts';
import type { Plan, ProjectManifest, RepoEntry, TrellisConfig } from '../../core/types.ts';

// --- Async git executor ---

export interface AsyncGitExecutor {
  (args: string[], cwd: string): Promise<string | null>;
}

export const defaultAsyncGit: AsyncGitExecutor = (args: string[], cwd: string): Promise<string | null> => {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'utf8', timeout: 30_000 }, (err, stdout) => {
      if (err) {
        resolve(null);
      } else {
        resolve(stdout);
      }
    });
  });
};

// --- Async git helpers (mirror manifest.ts but async) ---

async function ensureRemoteAsync(name: string, url: string, cwd: string, git: AsyncGitExecutor): Promise<void> {
  const result = await git(['remote', 'get-url', name], cwd);
  if (result === null) {
    await git(['remote', 'add', name, url], cwd);
  } else if (result.trim() !== url) {
    await git(['remote', 'set-url', name, url], cwd);
  }
}

async function fetchRemoteAsync(name: string, cwd: string, git: AsyncGitExecutor): Promise<{ ok: boolean; error?: string }> {
  const result = await git(['fetch', name], cwd);
  if (result === null) {
    return { ok: false, error: `Failed to fetch remote "${name}"` };
  }
  return { ok: true };
}

async function gitShowAsync(ref: string, cwd: string, git: AsyncGitExecutor): Promise<string | null> {
  return git(['show', ref], cwd);
}

async function gitListTreeAsync(ref: string, cwd: string, git: AsyncGitExecutor): Promise<string[]> {
  const result = await git(['ls-tree', '-d', '--name-only', ref], cwd);
  if (result === null) return [];
  return result.split('\n').filter(Boolean);
}

async function fetchRepoPlansAsync(
  alias: string,
  entry: RepoEntry,
  cwd: string,
  git: AsyncGitExecutor,
): Promise<{ plans: Plan[]; fetchFailed: boolean; error?: string }> {
  const remoteName = `trellis/${alias}`;
  await ensureRemoteAsync(remoteName, entry.url, cwd, git);
  const fetchResult = await fetchRemoteAsync(remoteName, cwd, git);
  if (!fetchResult.ok) {
    return { plans: [], fetchFailed: true, error: fetchResult.error };
  }

  const ref = `${remoteName}/${entry.branch}`;
  const dirs = await gitListTreeAsync(`${ref}:plans`, cwd, git);
  const plans: Plan[] = [];

  for (const dir of dirs) {
    const readmeRef = `${ref}:plans/${dir}/README.md`;
    const content = await gitShowAsync(readmeRef, cwd, git);
    if (!content) continue;

    const result = parseFrontmatter(content);
    if (!result) continue;

    plans.push({
      id: dir,
      filePath: `${ref}:plans/${dir}/README.md`,
      frontmatter: result.frontmatter,
      body: result.body,
      lineCount: content.split('\n').length,
      updatedAt: new Date(0),
      fileHashes: {},
      repoAlias: alias,
      remote: true,
    });
  }

  return { plans, fetchFailed: false };
}

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

async function discoverManifestAsync(
  manifestUrl: string,
  cwd: string,
  git: AsyncGitExecutor,
): Promise<ProjectManifest | null> {
  const remoteName = 'trellis/__manifest';
  await ensureRemoteAsync(remoteName, manifestUrl, cwd, git);
  const fetchResult = await fetchRemoteAsync(remoteName, cwd, git);
  if (!fetchResult.ok) return null;

  const content = await gitShowAsync(`${remoteName}/main:.trellis-project`, cwd, git);
  if (!content) return null;

  try {
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
