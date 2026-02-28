import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import matter from 'gray-matter';
import { resolveCliContext } from '../core/cli-context.ts';
import { createFixture, type FixturePlan } from './helpers.ts';
import { createCommand } from '../features/create/command.ts';
import { setCommand } from '../features/set/command.ts';
import { updateCommand } from '../features/update/command.ts';

// =============================================
// Multi-repo CLI fixture helper
// =============================================

interface RepoFixture {
  alias: string;
  plans: FixturePlan[];
}

interface MultiRepoCliFixture {
  metaRoot: string;
  repos: Array<{ alias: string; root: string; plansDir: string }>;
}

function createMultiRepoCliFixture(repoFixtures: RepoFixture[]): MultiRepoCliFixture {
  const metaRoot = mkdtempSync(join(tmpdir(), 'trellis-cli-meta-'));
  const repos: MultiRepoCliFixture['repos'] = [];

  for (const rf of repoFixtures) {
    const { root, plansDir } = createFixture(rf.plans);
    writeFileSync(
      join(root, '.trellis', 'config'),
      `project: ${rf.alias}\nplans_dir: plans\nproject_root: ${metaRoot}\n`,
    );
    repos.push({ alias: rf.alias, root, plansDir });
  }

  const manifestLines = ['name: test-project', 'repos:'];
  for (const repo of repos) {
    manifestLines.push(`  ${repo.alias}:`, `    path: ${repo.root}`);
  }
  writeFileSync(join(metaRoot, '.trellis-project'), manifestLines.join('\n'));

  return { metaRoot, repos };
}

// =============================================
// resolveCliContext
// =============================================

describe('resolveCliContext', () => {
  it('returns multi-repo context when project_root is set', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'plan-a', title: 'Plan A', status: 'draft' }] },
      { alias: 'repo-b', plans: [] },
    ]);

    const ctx = resolveCliContext(repos[0].root);
    expect(ctx.isMultiRepo).toBe(true);
    expect(ctx.graph.plans.has('repo-a:plan-a')).toBe(true);
  });

  it('returns single-repo context when no manifest available', () => {
    const { root } = createFixture([
      { id: 'local-plan', title: 'Local', status: 'draft' },
    ]);

    const ctx = resolveCliContext(root);
    expect(ctx.isMultiRepo).toBe(false);
    expect(ctx.graph.plans.has('local-plan')).toBe(true);
  });

  it('resolves plans from all repos', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'alpha', plans: [{ id: 'auth', title: 'Auth', status: 'draft' }] },
      { alias: 'beta', plans: [{ id: 'ui', title: 'UI', status: 'draft' }] },
    ]);

    const ctx = resolveCliContext(repos[0].root);
    expect(ctx.graph.plans.has('alpha:auth')).toBe(true);
    expect(ctx.graph.plans.has('beta:ui')).toBe(true);
  });

  it('getPlansDir resolves alias to plans directory', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    const ctx = resolveCliContext(repos[0].root);
    const plansDir = ctx.getPlansDir('repo-a');
    expect(plansDir).toContain('plans');
  });

  it('getPlansDir throws for unknown alias with manifest guidance', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    const ctx = resolveCliContext(repos[0].root);
    expect(() => ctx.getPlansDir('nonexistent')).toThrow('not found in manifest');
  });
});

// =============================================
// CLI create command with qualified ID
// =============================================

describe('CLI create with qualified ID', () => {
  let originalCwd: () => string;

  beforeEach(() => {
    originalCwd = process.cwd;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
  });

  it('creates plan in target repo with dequalified deps', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'foundation', title: 'Foundation', status: 'draft' }] },
      { alias: 'repo-b', plans: [] },
    ]);

    // Run from repo-b, create in repo-a
    process.cwd = () => repos[1].root;
    createCommand('repo-a:new-plan', {
      title: 'New Plan',
      dependsOn: ['repo-a:foundation'],
    });

    // Verify plan created in repo-a's plans dir
    const readmePath = join(repos[0].plansDir, 'new-plan', 'README.md');
    expect(existsSync(readmePath)).toBe(true);

    const readme = readFileSync(readmePath, 'utf8');
    const fm = matter(readme).data;
    expect(fm.title).toBe('New Plan');
    // Same-repo dep should be dequalified
    expect(fm.depends_on).toEqual(['foundation']);
  });

  it('creates plan with cross-repo deps preserved', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'foundation', title: 'Foundation', status: 'draft' }] },
      { alias: 'repo-b', plans: [{ id: 'other', title: 'Other', status: 'draft' }] },
    ]);

    process.cwd = () => repos[0].root;
    createCommand('repo-a:new-plan', {
      title: 'New Plan',
      dependsOn: ['repo-a:foundation', 'repo-b:other'],
    });

    const readme = readFileSync(join(repos[0].plansDir, 'new-plan', 'README.md'), 'utf8');
    // Same-repo dequalified, cross-repo preserved
    expect(readme).toContain('- foundation');
    expect(readme).toMatch(/repo-b:other/);
    expect(readme).not.toMatch(/repo-a:foundation/);
  });

  it('local create still works without manifest', () => {
    const { root, plansDir } = createFixture([]);

    process.cwd = () => root;
    createCommand('local-plan', { title: 'Local Plan' });

    expect(existsSync(join(plansDir, 'local-plan', 'README.md'))).toBe(true);
  });

  it('errors with guidance for qualified ID in single-repo mode', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    createCommand('some-repo:new-plan', { title: 'Test' });

    expect(process.exitCode).toBe(1);
  });
});

// =============================================
// CLI set command with qualified ID
// =============================================

describe('CLI set with qualified ID', () => {
  let originalCwd: () => string;

  beforeEach(() => {
    originalCwd = process.cwd;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
  });

  it('updates field on plan in target repo', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'plan-1', title: 'Plan 1', status: 'draft', body: '\n## Problem\nText\n' }] },
    ]);

    process.cwd = () => repos[0].root;
    setCommand('repo-a:plan-1', 'description', ['Updated desc'], {});

    const readme = readFileSync(join(repos[0].plansDir, 'plan-1', 'README.md'), 'utf8');
    const fm = matter(readme).data;
    expect(fm.description).toBe('Updated desc');
  });

  it('set works with unqualified ID in multi-repo mode', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'unique-plan', title: 'Unique', status: 'draft', body: '\n## Problem\nText\n' }] },
    ]);

    process.cwd = () => repos[0].root;
    // Unqualified ID should resolve uniquely
    setCommand('unique-plan', 'description', ['Via unqualified'], {});

    const readme = readFileSync(join(repos[0].plansDir, 'unique-plan', 'README.md'), 'utf8');
    const fm = matter(readme).data;
    expect(fm.description).toBe('Via unqualified');
  });
});

// =============================================
// CLI update command with qualified ID
// =============================================

describe('CLI update with qualified ID', () => {
  let originalCwd: () => string;

  beforeEach(() => {
    originalCwd = process.cwd;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
  });

  it('transitions status on plan in target repo', async () => {
    const { repos } = createMultiRepoCliFixture([
      {
        alias: 'repo-a',
        plans: [{
          id: 'plan-1',
          title: 'Plan 1',
          status: 'not_started',
          body: '\n## Problem\nText\n\n## Approach\nDo it\n',
          implementationMd: '## Steps\n1. Do\n\n## Testing\nTest\n\n## Done-when\nDone\n',
        }],
      },
    ]);

    process.cwd = () => repos[0].root;
    await updateCommand('repo-a:plan-1', 'in_progress', { yes: true });

    const readme = readFileSync(join(repos[0].plansDir, 'plan-1', 'README.md'), 'utf8');
    const fm = matter(readme).data;
    expect(fm.status).toBe('in_progress');
  });

  it('update works with force flag', async () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'plan-1', title: 'Plan 1', status: 'draft', body: '\n## Problem\nText\n' }] },
    ]);

    process.cwd = () => repos[0].root;
    await updateCommand('repo-a:plan-1', 'in_progress', { force: true, yes: true });

    const readme = readFileSync(join(repos[0].plansDir, 'plan-1', 'README.md'), 'utf8');
    const fm = matter(readme).data;
    expect(fm.status).toBe('in_progress');
  });
});
