import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { computeSync, runWithConcurrency, resolveLocalManifest } from './logic.ts';
import type { AsyncGitExecutor, ComputeSyncOptions, RepoSyncResult } from './logic.ts';
import { readCache, writeCache, isCacheStale } from '../../core/cache.ts';
import type { Plan } from '../../core/types.ts';

// --- Helpers ---

function createTestDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'trellis-sync-test-'));
  mkdirSync(join(root, '.trellis'), { recursive: true });
  writeFileSync(join(root, '.trellis', 'config'), 'project: test-project\nplans_dir: plans\n');
  mkdirSync(join(root, 'plans'), { recursive: true });
  return root;
}

function planReadme(title: string, status: string = 'not_started'): string {
  return `---\ntitle: ${title}\nstatus: ${status}\n---\n`;
}

/** Creates a mock git executor that simulates repos with plans. */
function createMockGit(repos: Record<string, { plans: Record<string, string>; failFetch?: boolean; delay?: number }>): AsyncGitExecutor {
  return async (args: string[], _cwd: string): Promise<string | null> => {
    const cmd = args[0];

    // Extract alias from remote name (trellis/<alias> or trellis/__manifest)
    if (cmd === 'remote') {
      const subCmd = args[1];
      if (subCmd === 'get-url') return null; // remote doesn't exist yet
      if (subCmd === 'add' || subCmd === 'set-url') return '';
    }

    if (cmd === 'fetch') {
      const remoteName = args[1];
      const alias = remoteName.replace('trellis/', '');

      if (alias === '__manifest') return ''; // manifest fetch always succeeds
      if (repos[alias]?.failFetch) return null;

      // Simulate delay for parallelism tests
      if (repos[alias]?.delay) {
        await new Promise(r => setTimeout(r, repos[alias].delay!));
      }
      return '';
    }

    if (cmd === 'ls-tree') {
      // args: ['ls-tree', '-d', '--name-only', 'trellis/<alias>/<branch>:plans']
      const ref = args[3]; // e.g. 'trellis/canopy/main:plans'
      const match = ref.match(/^trellis\/([^/]+)\//);
      if (!match) return null;
      const alias = match[1];
      if (!repos[alias]) return null;
      return Object.keys(repos[alias].plans).join('\n') + '\n';
    }

    if (cmd === 'show') {
      // args: ['show', 'trellis/<alias>/<branch>:plans/<planId>/README.md']
      const ref = args[1];
      const match = ref.match(/^trellis\/([^/]+)\/[^:]+:plans\/([^/]+)\/README\.md$/);
      if (!match) return null;
      const [, alias, planId] = match;
      return repos[alias]?.plans[planId] ?? null;
    }

    return null;
  };
}

// --- runWithConcurrency tests ---

describe('runWithConcurrency', () => {
  it('runs all tasks and returns results in order', async () => {
    const tasks = [
      async () => 'a',
      async () => 'b',
      async () => 'c',
    ];

    const results = await runWithConcurrency(tasks, 3);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('respects concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;

    const makeTask = (id: number) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 20));
      active--;
      return id;
    };

    const tasks = Array.from({ length: 10 }, (_, i) => makeTask(i));
    const results = await runWithConcurrency(tasks, 3);

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(results).toHaveLength(10);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('handles empty task list', async () => {
    const results = await runWithConcurrency([], 5);
    expect(results).toEqual([]);
  });

  it('runs tasks in parallel (wall-clock time)', async () => {
    const tasks = Array.from({ length: 5 }, () => async () => {
      await new Promise(r => setTimeout(r, 50));
      return 'done';
    });

    const start = Date.now();
    await runWithConcurrency(tasks, 5);
    const elapsed = Date.now() - start;

    // 5 tasks of 50ms each, all parallel → should take ~50ms, not 250ms
    expect(elapsed).toBeLessThan(150);
  });
});

// --- resolveLocalManifest tests ---

describe('resolveLocalManifest', () => {
  it('returns manifest from local .trellis-project', () => {
    const root = createTestDir();
    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
  acorn:
    url: git@github.com:org/acorn.git
    branch: main
    visibility: private
`);

    const manifest = resolveLocalManifest(root);
    expect(manifest).not.toBeNull();
    expect(manifest!.name).toBe('myorg');
    expect(Object.keys(manifest!.repos)).toEqual(['canopy', 'acorn']);
  });

  it('returns null when no .trellis-project exists', () => {
    const root = createTestDir();
    const manifest = resolveLocalManifest(root);
    expect(manifest).toBeNull();
  });

  it('returns null on invalid YAML', () => {
    const root = createTestDir();
    writeFileSync(join(root, '.trellis-project'), 'not: [valid: yaml: {{{');

    const manifest = resolveLocalManifest(root);
    expect(manifest).toBeNull();
  });
});

// --- computeSync tests ---

describe('computeSync', () => {
  it('syncs all repos from manifest and caches results', async () => {
    const root = createTestDir();
    const git = createMockGit({
      canopy: {
        plans: {
          'plan-a': planReadme('Plan A'),
          'plan-b': planReadme('Plan B', 'in_progress'),
        },
      },
      acorn: {
        plans: {
          'plan-c': planReadme('Plan C', 'done'),
        },
      },
    });

    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
  acorn:
    url: git@github.com:org/acorn.git
    branch: main
    visibility: private
`);

    const result = await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      git,
    });

    expect(result.project).toBe('myorg');
    expect(result.totalPlans).toBe(3);
    expect(result.totalRepos).toBe(2);
    expect(result.successfulRepos).toBe(2);
    expect(result.repos).toHaveLength(2);

    const canopy = result.repos.find(r => r.alias === 'canopy')!;
    expect(canopy.status).toBe('ok');
    expect(canopy.planCount).toBe(2);

    const acorn = result.repos.find(r => r.alias === 'acorn')!;
    expect(acorn.status).toBe('ok');
    expect(acorn.planCount).toBe(1);

    // Verify cache was written
    const cachedCanopy = readCache<Plan[]>(root, 'plans/canopy');
    expect(cachedCanopy).not.toBeNull();
    expect(cachedCanopy!.data).toHaveLength(2);

    const cachedAcorn = readCache<Plan[]>(root, 'plans/acorn');
    expect(cachedAcorn).not.toBeNull();
    expect(cachedAcorn!.data).toHaveLength(1);
  });

  it('handles partial failures (some repos fail, some succeed)', async () => {
    const root = createTestDir();
    const git = createMockGit({
      canopy: {
        plans: { 'plan-a': planReadme('Plan A') },
      },
      acorn: {
        plans: {},
        failFetch: true,
      },
      birch: {
        plans: { 'plan-b': planReadme('Plan B') },
      },
    });

    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
  acorn:
    url: git@github.com:org/acorn.git
    branch: main
    visibility: private
  birch:
    url: git@github.com:org/birch.git
    branch: main
    visibility: public
`);

    const result = await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      git,
    });

    expect(result.successfulRepos).toBe(2);
    expect(result.totalRepos).toBe(3);
    expect(result.totalPlans).toBe(2);

    const acorn = result.repos.find(r => r.alias === 'acorn')!;
    expect(acorn.status).toBe('error');
    expect(acorn.error).toBeTruthy();

    const canopy = result.repos.find(r => r.alias === 'canopy')!;
    expect(canopy.status).toBe('ok');
  });

  it('all repos fail → still returns results (no throw)', async () => {
    const root = createTestDir();
    const git = createMockGit({
      canopy: { plans: {}, failFetch: true },
      acorn: { plans: {}, failFetch: true },
    });

    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
  acorn:
    url: git@github.com:org/acorn.git
    branch: main
    visibility: private
`);

    const result = await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      git,
    });

    expect(result.successfulRepos).toBe(0);
    expect(result.totalRepos).toBe(2);
    expect(result.repos.every(r => r.status === 'error')).toBe(true);
  });

  it('filters to single repo with --repo flag', async () => {
    const root = createTestDir();
    const fetchedAliases: string[] = [];
    const git: AsyncGitExecutor = async (args, cwd) => {
      if (args[0] === 'fetch' && !args[1].includes('__manifest')) {
        fetchedAliases.push(args[1].replace('trellis/', ''));
      }
      return createMockGit({
        canopy: {
          plans: { 'plan-a': planReadme('Plan A') },
        },
        acorn: {
          plans: { 'plan-b': planReadme('Plan B') },
        },
      })(args, cwd);
    };

    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
  acorn:
    url: git@github.com:org/acorn.git
    branch: main
    visibility: private
`);

    const result = await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      repo: 'canopy',
      git,
    });

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].alias).toBe('canopy');
    expect(fetchedAliases).toEqual(['canopy']);
  });

  it('throws on --repo with nonexistent alias', async () => {
    const root = createTestDir();
    const git = createMockGit({});

    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
`);

    await expect(computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      repo: 'nonexistent',
      git,
    })).rejects.toThrow('Repo "nonexistent" not found in manifest');
  });

  it('throws when no manifest available', async () => {
    const root = createTestDir();
    const git: AsyncGitExecutor = async () => null;

    await expect(computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      git,
    })).rejects.toThrow('No manifest configured');
  });

  it('falls back to git manifest when no local .trellis-project', async () => {
    const root = createTestDir();
    // No .trellis-project file — should fall back to git

    const manifestContent = `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
`;

    const git: AsyncGitExecutor = async (args, _cwd) => {
      if (args[0] === 'remote') return null; // triggers add
      if (args[0] === 'fetch') return '';
      if (args[0] === 'show') {
        if (args[1].includes('__manifest')) return manifestContent;
        // Plan content
        const match = args[1].match(/plans\/([^/]+)\/README\.md$/);
        if (match && match[1] === 'plan-a') return planReadme('Plan A');
        return null;
      }
      if (args[0] === 'ls-tree') {
        if (args[3]?.includes('canopy')) return 'plan-a\n';
        return '';
      }
      return null;
    };

    const result = await computeSync({
      config: { project: 'test-project', plans_dir: 'plans', manifest: 'git@github.com:org/meta.git' },
      projectDir: root,
      git,
    });

    expect(result.project).toBe('myorg');
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].alias).toBe('canopy');
    expect(result.repos[0].planCount).toBe(1);
  });

  it('skips local project in manifest', async () => {
    const root = createTestDir();
    const git = createMockGit({
      canopy: {
        plans: { 'plan-a': planReadme('Plan A') },
      },
    });

    // test-project is the local project — should be skipped
    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
`);

    const result = await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      git,
    });

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].alias).toBe('canopy');
  });

  it('skips path-only entries (no URL)', async () => {
    const root = createTestDir();
    const git = createMockGit({
      canopy: {
        plans: { 'plan-a': planReadme('Plan A') },
      },
    });

    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  local-only:
    path: ../local-only
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
`);

    const result = await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      git,
    });

    // Only canopy should appear (local-only has no URL, test-project is local)
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].alias).toBe('canopy');
  });

  it('returns empty repos when manifest has no syncable repos', async () => {
    const root = createTestDir();

    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
`);

    const result = await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      git: createMockGit({}),
    });

    expect(result.repos).toHaveLength(0);
    expect(result.totalPlans).toBe(0);
  });

  it('includes timing data per repo', async () => {
    const root = createTestDir();
    const git = createMockGit({
      canopy: {
        plans: { 'plan-a': planReadme('Plan A') },
        delay: 20,
      },
    });

    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
`);

    const result = await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      git,
    });

    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.repos[0].durationMs).toBeGreaterThan(0);
  });

  it('caches manifest on sync', async () => {
    const root = createTestDir();
    const git = createMockGit({
      canopy: { plans: {} },
    });

    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
`);

    await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      git,
    });

    const cached = readCache(root, 'manifest');
    expect(cached).not.toBeNull();
    expect((cached!.data as any).name).toBe('myorg');
  });

  it('throws when manifest git fetch fails', async () => {
    const root = createTestDir();
    // No .trellis-project file, and git fetch for manifest returns null (failure)
    const git: AsyncGitExecutor = async (args) => {
      if (args[0] === 'remote') return null;
      if (args[0] === 'fetch') return null; // manifest fetch fails
      return null;
    };

    await expect(computeSync({
      config: { project: 'test-project', plans_dir: 'plans', manifest: 'git@github.com:org/meta.git' },
      projectDir: root,
      git,
    })).rejects.toThrow('Failed to discover project manifest');
  });
});

// --- Parallelism verification ---

describe('parallel execution', () => {
  it('5 repos with 50ms delay each complete in under 150ms (parallelism verified)', async () => {
    const root = createTestDir();
    const repos: Record<string, any> = {};
    const repoYaml: string[] = [`  test-project:\n    url: git@github.com:org/test-project.git\n    branch: main\n    visibility: public`];

    for (let i = 0; i < 5; i++) {
      const alias = `repo-${i}`;
      repos[alias] = {
        plans: { [`plan-${i}`]: planReadme(`Plan ${i}`) },
        delay: 50,
      };
      repoYaml.push(`  ${alias}:\n    url: git@github.com:org/${alias}.git\n    branch: main\n    visibility: public`);
    }

    const git = createMockGit(repos);

    writeFileSync(join(root, '.trellis-project'), `name: myorg\nrepos:\n${repoYaml.join('\n')}\n`);

    const start = Date.now();
    const result = await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      concurrency: 5,
      git,
    });
    const elapsed = Date.now() - start;

    expect(result.successfulRepos).toBe(5);
    expect(result.totalPlans).toBe(5);
    // Sequential would be ~250ms+, parallel should be ~50-100ms
    expect(elapsed).toBeLessThan(150);
  });
});

// --- Cache format compatibility ---

describe('cache format compatibility', () => {
  it('cache is not stale immediately after sync', async () => {
    const root = createTestDir();
    const git = createMockGit({
      canopy: { plans: { 'plan-a': planReadme('Plan A') } },
    });

    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
`);

    await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      git,
    });

    const cached = readCache<Plan[]>(root, 'plans/canopy');
    expect(cached).not.toBeNull();
    expect(isCacheStale(cached!)).toBe(false);

    const manifestCache = readCache(root, 'manifest');
    expect(manifestCache).not.toBeNull();
    expect(isCacheStale(manifestCache!)).toBe(false);
  });

  it('sync overwrites stale cache with new data', async () => {
    const root = createTestDir();

    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
`);

    // First sync: canopy has plan-a
    const git1 = createMockGit({
      canopy: { plans: { 'plan-a': planReadme('Plan A') } },
    });

    await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      git: git1,
    });

    const firstCache = readCache<Plan[]>(root, 'plans/canopy');
    expect(firstCache!.data).toHaveLength(1);
    expect(firstCache!.data[0].id).toBe('plan-a');

    // Second sync: canopy now has plan-x and plan-y (plan-a removed)
    const git2 = createMockGit({
      canopy: { plans: { 'plan-x': planReadme('Plan X'), 'plan-y': planReadme('Plan Y') } },
    });

    await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      git: git2,
    });

    const secondCache = readCache<Plan[]>(root, 'plans/canopy');
    expect(secondCache!.data).toHaveLength(2);
    expect(secondCache!.data.map(p => p.id).sort()).toEqual(['plan-x', 'plan-y']);
  });

  it('single-repo sync does not affect other repos cache', async () => {
    const root = createTestDir();

    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
  acorn:
    url: git@github.com:org/acorn.git
    branch: main
    visibility: private
`);

    // Pre-populate acorn cache
    writeCache(root, 'plans/acorn', [{ id: 'old-plan', frontmatter: { title: 'Old', status: 'done' } }]);
    const acornBefore = readCache(root, 'plans/acorn');
    expect(acornBefore).not.toBeNull();

    // Sync only canopy
    const git = createMockGit({
      canopy: { plans: { 'plan-a': planReadme('Plan A') } },
      acorn: { plans: { 'plan-b': planReadme('Plan B') } },
    });

    await computeSync({
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: root,
      repo: 'canopy',
      git,
    });

    // Canopy cache updated
    const canopyCache = readCache<Plan[]>(root, 'plans/canopy');
    expect(canopyCache).not.toBeNull();
    expect(canopyCache!.data).toHaveLength(1);

    // Acorn cache untouched — same data, same fetchedAt
    const acornAfter = readCache(root, 'plans/acorn');
    expect(acornAfter).not.toBeNull();
    expect(acornAfter!.fetchedAt).toBe(acornBefore!.fetchedAt);
    expect((acornAfter!.data as any[])[0].id).toBe('old-plan');
  });
});

// --- Double sync (no lock file issues) ---

describe('double sync', () => {
  it('second sync succeeds immediately after first', async () => {
    const root = createTestDir();
    const git = createMockGit({
      canopy: { plans: { 'plan-a': planReadme('Plan A') } },
    });

    writeFileSync(join(root, '.trellis-project'), `
name: myorg
repos:
  test-project:
    url: git@github.com:org/test-project.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:org/canopy.git
    branch: main
    visibility: public
`);

    const opts = {
      config: { project: 'test-project', plans_dir: 'plans' } as const,
      projectDir: root,
      git,
    };

    const result1 = await computeSync(opts);
    expect(result1.successfulRepos).toBe(1);

    const result2 = await computeSync(opts);
    expect(result2.successfulRepos).toBe(1);
    expect(result2.totalPlans).toBe(1);

    // Both wrote to cache — second overwrites first cleanly
    const cached = readCache<Plan[]>(root, 'plans/canopy');
    expect(cached).not.toBeNull();
    expect(cached!.data).toHaveLength(1);
  });
});
