import yaml from 'js-yaml';
import { execFileSync, execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { readFile, access } from 'fs/promises';
import { resolve, dirname, isAbsolute } from 'path';
import { homedir } from 'os';
import { parseFrontmatter } from './frontmatter.ts';
import type { Plan, ProjectManifest, RepoEntry, ResolvedRepo, ValidationError } from './types.ts';

export interface GitExecutor {
  (args: string[], cwd: string): string | null;
}

const defaultGitExecutor: GitExecutor = (args: string[], cwd: string): string | null => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
};

export function parseManifest(content: string): ProjectManifest {
  const doc = yaml.load(content) as Record<string, unknown>;
  if (!doc || typeof doc !== 'object') {
    throw new Error('Invalid manifest: not a YAML object');
  }
  if (!doc.name || typeof doc.name !== 'string') {
    throw new Error('Invalid manifest: missing or non-string "name"');
  }
  if (doc.base_dir !== undefined && typeof doc.base_dir !== 'string') {
    throw new Error('Invalid manifest: "base_dir" must be a string');
  }
  if (!doc.repos || typeof doc.repos !== 'object' || Array.isArray(doc.repos)) {
    throw new Error('Invalid manifest: missing or invalid "repos"');
  }
  const repos = doc.repos as Record<string, unknown>;
  const entries = Object.keys(repos);
  if (entries.length === 0) {
    throw new Error('Invalid manifest: "repos" is empty');
  }
  const result: Record<string, RepoEntry> = {};
  for (const alias of entries) {
    if (!alias) {
      throw new Error('Invalid manifest: empty repo alias');
    }
    const entry = repos[alias] as Record<string, unknown>;
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid manifest: repo "${alias}" is not an object`);
    }

    const hasPath = entry.path && typeof entry.path === 'string';
    const hasUrl = entry.url && typeof entry.url === 'string';

    // Validate optional display metadata
    if (entry.name !== undefined && typeof entry.name !== 'string') {
      throw new Error(`Invalid manifest: repo "${alias}" has non-string "name"`);
    }
    if (entry.description !== undefined && typeof entry.description !== 'string') {
      throw new Error(`Invalid manifest: repo "${alias}" has non-string "description"`);
    }
    if (entry.tags !== undefined) {
      if (!Array.isArray(entry.tags) || !entry.tags.every((t: unknown) => typeof t === 'string')) {
        throw new Error(`Invalid manifest: repo "${alias}" has invalid "tags" (must be string array)`);
      }
    }
    if (entry.group !== undefined && typeof entry.group !== 'string') {
      throw new Error(`Invalid manifest: repo "${alias}" has non-string "group"`);
    }

    const metadata = {
      ...(entry.name ? { name: entry.name as string } : {}),
      ...(entry.description ? { description: entry.description as string } : {}),
      ...(entry.tags ? { tags: entry.tags as string[] } : {}),
      ...(entry.group ? { group: entry.group as string } : {}),
    };

    // Entries must have either url+branch+visibility (for git fetch) or path (for local)
    if (!hasUrl && !hasPath) {
      throw new Error(`Invalid manifest: repo "${alias}" missing "url" or "path"`);
    }

    if (hasUrl) {
      if (!entry.branch || typeof entry.branch !== 'string') {
        throw new Error(`Invalid manifest: repo "${alias}" missing "branch"`);
      }
      if (entry.visibility !== 'public' && entry.visibility !== 'private') {
        throw new Error(`Invalid manifest: repo "${alias}" has invalid visibility "${entry.visibility}" (must be "public" or "private")`);
      }
      result[alias] = {
        url: entry.url as string,
        branch: entry.branch as string,
        visibility: entry.visibility as 'public' | 'private',
        ...(hasPath ? { path: entry.path as string } : {}),
        ...metadata,
      };
    } else {
      // path-only entry (local repo, no git remote)
      result[alias] = {
        url: '',
        branch: '',
        visibility: 'private',
        path: entry.path as string,
        ...metadata,
      };
    }
  }
  return {
    name: doc.name,
    ...(doc.base_dir ? { base_dir: doc.base_dir as string } : {}),
    repos: result,
  };
}

export function ensureRemote(name: string, url: string, cwd: string, git: GitExecutor = defaultGitExecutor): void {
  const result = git(['remote', 'get-url', name], cwd);
  if (result === null) {
    git(['remote', 'add', name, url], cwd);
  } else if (result.trim() !== url) {
    git(['remote', 'set-url', name, url], cwd);
  }
}

export function fetchRemote(name: string, cwd: string, git: GitExecutor = defaultGitExecutor): { ok: boolean; error?: string } {
  const result = git(['fetch', name], cwd);
  if (result === null) {
    return { ok: false, error: `Failed to fetch remote "${name}"` };
  }
  return { ok: true };
}

export function gitShow(ref: string, cwd: string, git: GitExecutor = defaultGitExecutor): string | null {
  return git(['show', ref], cwd);
}

export function gitListTree(ref: string, cwd: string, git: GitExecutor = defaultGitExecutor): string[] {
  const result = git(['ls-tree', '-d', '--name-only', ref], cwd);
  if (result === null) return [];
  return result.split('\n').filter(Boolean);
}

export function discoverManifest(
  manifestUrl: string,
  cwd: string,
  git: GitExecutor = defaultGitExecutor,
): ProjectManifest | null {
  const remoteName = 'trellis/__manifest';
  ensureRemote(remoteName, manifestUrl, cwd, git);
  const fetchResult = fetchRemote(remoteName, cwd, git);
  if (!fetchResult.ok) return null;

  const content = gitShow(`${remoteName}/main:.trellis-project`, cwd, git);
  if (!content) return null;

  try {
    return parseManifest(content);
  } catch {
    return null;
  }
}

export interface FetchRepoResult {
  plans: Plan[];
  fetchFailed: boolean;
}

export function fetchRepoPlans(
  alias: string,
  entry: RepoEntry,
  cwd: string,
  git: GitExecutor = defaultGitExecutor,
): FetchRepoResult {
  const remoteName = `trellis/${alias}`;
  ensureRemote(remoteName, entry.url, cwd, git);
  const fetchResult = fetchRemote(remoteName, cwd, git);
  if (!fetchResult.ok) return { plans: [], fetchFailed: true };

  const ref = `${remoteName}/${entry.branch}`;
  const dirs = gitListTree(`${ref}:plans`, cwd, git);
  const plans: Plan[] = [];

  for (const dir of dirs) {
    const readmeRef = `${ref}:plans/${dir}/README.md`;
    const content = gitShow(readmeRef, cwd, git);
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

export function fetchProjectPlans(
  manifest: ProjectManifest,
  localProject: string,
  cwd: string,
  git: GitExecutor = defaultGitExecutor,
): Map<string, Plan[]> {
  const result = new Map<string, Plan[]>();

  for (const [alias, entry] of Object.entries(manifest.repos)) {
    if (alias === localProject) continue;

    const { plans, fetchFailed } = fetchRepoPlans(alias, entry, cwd, git);
    if (plans.length > 0) {
      result.set(alias, plans);
    } else if (fetchFailed) {
      console.error(`Warning: failed to fetch plans from "${alias}"`);
    }
  }

  return result;
}

export function checkVisibility(
  manifest: ProjectManifest,
  allPlans: Map<string, Plan[]>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [alias, plans] of allPlans) {
    const repoEntry = manifest.repos[alias];
    if (!repoEntry) continue;

    for (const plan of plans) {
      if (!plan.frontmatter.depends_on) continue;

      for (const dep of plan.frontmatter.depends_on) {
        // Qualified ID: "repo:plan-id" — only check cross-repo deps
        const colonIdx = dep.indexOf(':');
        if (colonIdx === -1) continue;

        const depRepo = dep.substring(0, colonIdx);
        const depEntry = manifest.repos[depRepo];
        if (!depEntry) continue;

        if (repoEntry.visibility === 'public' && depEntry.visibility === 'private') {
          errors.push({
            planId: plan.id,
            field: 'depends_on',
            message: `Public repo "${alias}" plan "${plan.id}" depends on private repo "${depRepo}" plan "${dep}" — public repos cannot depend on private repos`,
          });
        }
      }
    }
  }

  return errors;
}

export function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return p;
}

export function resolveProjectRepos(manifestPath: string): ResolvedRepo[] {
  const absManifestPath = isAbsolute(manifestPath) ? manifestPath : resolve(manifestPath);
  const content = readFileSync(absManifestPath, 'utf8');
  const manifest = parseManifest(content);

  const baseDir = manifest.base_dir
    ? expandTilde(manifest.base_dir)
    : dirname(absManifestPath);

  const results: ResolvedRepo[] = [];
  for (const [alias, entry] of Object.entries(manifest.repos)) {
    if (!entry.path) continue;

    const localPath = isAbsolute(entry.path)
      ? entry.path
      : resolve(baseDir, entry.path);

    results.push({
      alias,
      name: entry.name ?? alias,
      description: entry.description ?? '',
      tags: entry.tags ?? [],
      ...(entry.group ? { group: entry.group } : {}),
      url: entry.url,
      branch: entry.branch,
      visibility: entry.visibility,
      localPath,
      exists: existsSync(localPath),
    });
  }

  return results;
}

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

// --- Async git helpers ---

export async function ensureRemoteAsync(name: string, url: string, cwd: string, git: AsyncGitExecutor = defaultAsyncGit): Promise<void> {
  const result = await git(['remote', 'get-url', name], cwd);
  if (result === null) {
    await git(['remote', 'add', name, url], cwd);
  } else if (result.trim() !== url) {
    await git(['remote', 'set-url', name, url], cwd);
  }
}

export async function fetchRemoteAsync(name: string, cwd: string, git: AsyncGitExecutor = defaultAsyncGit): Promise<{ ok: boolean; error?: string }> {
  const result = await git(['fetch', name], cwd);
  if (result === null) {
    return { ok: false, error: `Failed to fetch remote "${name}"` };
  }
  return { ok: true };
}

export async function gitShowAsync(ref: string, cwd: string, git: AsyncGitExecutor = defaultAsyncGit): Promise<string | null> {
  return git(['show', ref], cwd);
}

export async function gitListTreeAsync(ref: string, cwd: string, git: AsyncGitExecutor = defaultAsyncGit): Promise<string[]> {
  const result = await git(['ls-tree', '-d', '--name-only', ref], cwd);
  if (result === null) return [];
  return result.split('\n').filter(Boolean);
}

export async function discoverManifestAsync(
  manifestUrl: string,
  cwd: string,
  git: AsyncGitExecutor = defaultAsyncGit,
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

export interface AsyncFetchRepoResult {
  plans: Plan[];
  fetchFailed: boolean;
  error?: string;
}

export async function fetchRepoPlansAsync(
  alias: string,
  entry: RepoEntry,
  cwd: string,
  git: AsyncGitExecutor = defaultAsyncGit,
): Promise<AsyncFetchRepoResult> {
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

export async function resolveProjectReposAsync(manifestPath: string): Promise<ResolvedRepo[]> {
  const absManifestPath = isAbsolute(manifestPath) ? manifestPath : resolve(manifestPath);
  const content = await readFile(absManifestPath, 'utf8');
  const manifest = parseManifest(content);

  const baseDir = manifest.base_dir
    ? expandTilde(manifest.base_dir)
    : dirname(absManifestPath);

  const results: ResolvedRepo[] = [];
  for (const [alias, entry] of Object.entries(manifest.repos)) {
    if (!entry.path) continue;

    const localPath = isAbsolute(entry.path)
      ? entry.path
      : resolve(baseDir, entry.path);

    let exists = false;
    try {
      await access(localPath);
      exists = true;
    } catch {
      // path doesn't exist
    }

    results.push({
      alias,
      name: entry.name ?? alias,
      description: entry.description ?? '',
      tags: entry.tags ?? [],
      ...(entry.group ? { group: entry.group } : {}),
      url: entry.url,
      branch: entry.branch,
      visibility: entry.visibility,
      localPath,
      exists,
    });
  }

  return results;
}
