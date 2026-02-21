import yaml from 'js-yaml';
import { execFileSync } from 'child_process';
import { parseFrontmatter } from './frontmatter.ts';
import type { Plan, ProjectManifest, RepoEntry, ValidationError } from './types.ts';

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
    if (!entry.url || typeof entry.url !== 'string') {
      throw new Error(`Invalid manifest: repo "${alias}" missing "url"`);
    }
    if (!entry.branch || typeof entry.branch !== 'string') {
      throw new Error(`Invalid manifest: repo "${alias}" missing "branch"`);
    }
    if (entry.visibility !== 'public' && entry.visibility !== 'private') {
      throw new Error(`Invalid manifest: repo "${alias}" has invalid visibility "${entry.visibility}" (must be "public" or "private")`);
    }
    result[alias] = {
      url: entry.url,
      branch: entry.branch,
      visibility: entry.visibility,
    };
  }
  return { name: doc.name, repos: result };
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
