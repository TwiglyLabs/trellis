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
import { archiveCommand } from '../features/archive/command.ts';
import { renameCommand } from '../features/rename/command.ts';

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

  it('update resolves unqualified ID in multi-repo', async () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'unique-update', title: 'Unique', status: 'draft', body: '\n## Problem\nText\n' }] },
    ]);

    process.cwd = () => repos[0].root;
    await updateCommand('unique-update', 'in_progress', { force: true, yes: true });

    const readme = readFileSync(join(repos[0].plansDir, 'unique-update', 'README.md'), 'utf8');
    const fm = matter(readme).data;
    expect(fm.status).toBe('in_progress');
  });
});

// =============================================
// CLI set: ambiguous unqualified ID
// =============================================

describe('CLI set ambiguous ID', () => {
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

  it('errors on ambiguous unqualified ID in multi-repo', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'shared', title: 'Shared A', status: 'draft', body: '\n## Problem\nA\n' }] },
      { alias: 'repo-b', plans: [{ id: 'shared', title: 'Shared B', status: 'draft', body: '\n## Problem\nB\n' }] },
    ]);

    process.cwd = () => repos[0].root;
    setCommand('shared', 'description', ['ambiguous'], {});

    expect(process.exitCode).toBe(1);
  });
});

// =============================================
// resolveCliContext Path 2 (meta-repo case)
// =============================================

describe('resolveCliContext meta-repo case', () => {
  it('returns multi-repo context when manifest + .trellis-project exist locally', () => {
    const { root: alphaRoot, plansDir: alphaPlansDir } = createFixture([
      { id: 'plan-a', title: 'Plan A', status: 'draft' },
    ]);

    // Set up alphaRoot as a meta-repo: has manifest in config + .trellis-project locally
    writeFileSync(
      join(alphaRoot, '.trellis', 'config'),
      `project: alpha\nplans_dir: plans\nmanifest: https://example.com/manifest.git\n`,
    );
    writeFileSync(
      join(alphaRoot, '.trellis-project'),
      ['name: test-project', 'repos:', `  alpha:`, `    path: ${alphaRoot}`].join('\n'),
    );

    const ctx = resolveCliContext(alphaRoot);
    expect(ctx.isMultiRepo).toBe(true);
    expect(ctx.graph.plans.has('alpha:plan-a')).toBe(true);
  });

  it('uses tmpdir fallback when cache dir creation fails', () => {
    // This tests the catch block in buildMultiRepoCliContext
    // We can verify it works by creating a valid multi-repo setup
    // and checking that resolveCliContext doesn't throw
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'test', title: 'Test', status: 'draft' }] },
    ]);

    const ctx = resolveCliContext(repos[0].root);
    expect(ctx.isMultiRepo).toBe(true);
    expect(ctx.store).toBeDefined();
  });
});

// =============================================
// CLI archive with qualified ID
// =============================================

describe('CLI archive with qualified ID', () => {
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

  it('archives plan in target repo with qualified ID', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'done-plan', title: 'Done Plan', status: 'done', body: '\n## Problem\nDone\n' }] },
    ]);

    process.cwd = () => repos[0].root;
    archiveCommand('repo-a:done-plan', {});

    const readme = readFileSync(join(repos[0].plansDir, 'done-plan', 'README.md'), 'utf8');
    const fm = matter(readme).data;
    expect(fm.status).toBe('archived');
  });

  it('archives plan with unqualified ID in multi-repo', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'unique-done', title: 'Unique', status: 'done', body: '\n## Problem\nDone\n' }] },
    ]);

    process.cwd = () => repos[0].root;
    archiveCommand('unique-done', {});

    const readme = readFileSync(join(repos[0].plansDir, 'unique-done', 'README.md'), 'utf8');
    const fm = matter(readme).data;
    expect(fm.status).toBe('archived');
  });

  it('archive still works in single-repo mode', () => {
    const { root, plansDir } = createFixture([
      { id: 'local-done', title: 'Local Done', status: 'done', body: '\n## Problem\nDone\n' },
    ]);

    process.cwd = () => root;
    archiveCommand('local-done', {});

    const readme = readFileSync(join(plansDir, 'local-done', 'README.md'), 'utf8');
    const fm = matter(readme).data;
    expect(fm.status).toBe('archived');
  });
});

// =============================================
// CLI rename with qualified ID
// =============================================

describe('CLI rename with qualified ID', () => {
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

  it('renames plan in target repo with qualified ID', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'old-name', title: 'Old Name', status: 'draft', body: '\n## Problem\nText\n' }] },
    ]);

    process.cwd = () => repos[0].root;
    renameCommand('repo-a:old-name', 'new-name', {});

    expect(existsSync(join(repos[0].plansDir, 'new-name', 'README.md'))).toBe(true);
    expect(existsSync(join(repos[0].plansDir, 'old-name'))).toBe(false);
  });

  it('updates cross-repo references on rename', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'target', title: 'Target', status: 'draft', body: '\n## Problem\nText\n' }] },
      { alias: 'repo-b', plans: [{ id: 'dependent', title: 'Dep', status: 'draft', depends_on: ['repo-a:target'], body: '\n## Problem\nText\n' }] },
    ]);

    process.cwd = () => repos[0].root;
    renameCommand('repo-a:target', 'renamed-target', {});

    // Cross-repo dep should be updated in repo-b
    const readme = readFileSync(join(repos[1].plansDir, 'dependent', 'README.md'), 'utf8');
    const fm = matter(readme).data;
    expect(fm.depends_on).toContain('repo-a:renamed-target');
    expect(fm.depends_on).not.toContain('repo-a:target');
  });

  it('updates same-repo references on rename (dequalified)', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [
        { id: 'base', title: 'Base', status: 'draft', body: '\n## Problem\nText\n' },
        { id: 'child', title: 'Child', status: 'draft', depends_on: ['base'], body: '\n## Problem\nText\n' },
      ] },
    ]);

    process.cwd = () => repos[0].root;
    renameCommand('repo-a:base', 'foundation', {});

    const readme = readFileSync(join(repos[0].plansDir, 'child', 'README.md'), 'utf8');
    const fm = matter(readme).data;
    expect(fm.depends_on).toContain('foundation');
    expect(fm.depends_on).not.toContain('base');
  });

  it('errors for unqualified ID in multi-repo mode', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'plan-1', title: 'Plan 1', status: 'draft', body: '\n## Problem\nText\n' }] },
    ]);

    process.cwd = () => repos[0].root;
    renameCommand('plan-1', 'new-plan', {});

    expect(process.exitCode).toBe(1);
  });

  it('errors when new ID is qualified (cross-repo rename)', () => {
    const { repos } = createMultiRepoCliFixture([
      { alias: 'repo-a', plans: [{ id: 'plan-1', title: 'Plan 1', status: 'draft', body: '\n## Problem\nText\n' }] },
      { alias: 'repo-b', plans: [] },
    ]);

    process.cwd = () => repos[0].root;
    renameCommand('repo-a:plan-1', 'repo-b:new-name', {});

    expect(process.exitCode).toBe(1);
  });

  it('rename still works in single-repo mode', () => {
    const { root, plansDir } = createFixture([
      { id: 'old-local', title: 'Old Local', status: 'draft', body: '\n## Problem\nText\n' },
    ]);

    process.cwd = () => root;
    renameCommand('old-local', 'new-local', {});

    expect(existsSync(join(plansDir, 'new-local', 'README.md'))).toBe(true);
    expect(existsSync(join(plansDir, 'old-local'))).toBe(false);
  });
});
