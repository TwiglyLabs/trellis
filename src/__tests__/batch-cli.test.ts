import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, writeFileSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import matter from 'gray-matter';
import { createFixture, type FixturePlan } from './helpers.ts';
import { createBatchCommand } from '../features/create/batch-command.ts';

// =============================================
// Multi-repo CLI fixture helper for batch
// =============================================

interface RepoFixture {
  alias: string;
  plans: FixturePlan[];
}

interface BatchCliFixture {
  metaRoot: string;
  repos: Array<{ alias: string; root: string; plansDir: string }>;
}

function createBatchCliFixture(repoFixtures: RepoFixture[]): BatchCliFixture {
  const metaRoot = mkdtempSync(join(tmpdir(), 'trellis-batch-cli-'));
  const repos: BatchCliFixture['repos'] = [];

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
// Tests
// =============================================

describe('trellis create-batch CLI', () => {
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

  it('creates plans from YAML file', () => {
    const { metaRoot, repos } = createBatchCliFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    const batchFile = join(metaRoot, 'batch.yaml');
    writeFileSync(batchFile, [
      'plans:',
      '  - id: repo-a:plan-a',
      '    title: Plan A',
      '  - id: repo-a:plan-b',
      '    title: Plan B',
      '    depends_on: [repo-a:plan-a]',
    ].join('\n'));

    process.cwd = () => repos[0].root;
    createBatchCommand(batchFile, {});

    expect(existsSync(join(repos[0].plansDir, 'plan-a', 'README.md'))).toBe(true);
    expect(existsSync(join(repos[0].plansDir, 'plan-b', 'README.md'))).toBe(true);
  });

  it('creates plans across repos', () => {
    const { metaRoot, repos } = createBatchCliFixture([
      { alias: 'repo-a', plans: [] },
      { alias: 'repo-b', plans: [] },
    ]);

    const batchFile = join(metaRoot, 'batch.yaml');
    writeFileSync(batchFile, [
      'plans:',
      '  - id: repo-a:infra',
      '    title: Infrastructure',
      '  - id: repo-b:feature',
      '    title: Feature',
      '    depends_on: [repo-a:infra]',
    ].join('\n'));

    process.cwd = () => repos[0].root;
    createBatchCommand(batchFile, {});

    expect(existsSync(join(repos[0].plansDir, 'infra', 'README.md'))).toBe(true);
    expect(existsSync(join(repos[1].plansDir, 'feature', 'README.md'))).toBe(true);

    // Cross-repo dep preserved in frontmatter
    const readme = readFileSync(join(repos[1].plansDir, 'feature', 'README.md'), 'utf8');
    expect(readme).toMatch(/repo-a:infra/);
  });

  it('dry-run does not write files', () => {
    const { metaRoot, repos } = createBatchCliFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    const batchFile = join(metaRoot, 'batch.yaml');
    writeFileSync(batchFile, [
      'plans:',
      '  - id: repo-a:plan-a',
      '    title: Plan A',
    ].join('\n'));

    process.cwd = () => repos[0].root;
    createBatchCommand(batchFile, { dryRun: true });

    expect(existsSync(join(repos[0].plansDir, 'plan-a'))).toBe(false);
  });

  it('errors on invalid batch file', () => {
    const { metaRoot, repos } = createBatchCliFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    const batchFile = join(metaRoot, 'bad.yaml');
    writeFileSync(batchFile, 'not_plans: true');

    process.cwd = () => repos[0].root;
    createBatchCommand(batchFile, {});

    expect(process.exitCode).toBe(1);
  });

  it('errors in single-repo mode', () => {
    const { root } = createFixture([]);
    const batchFile = join(root, 'batch.yaml');
    writeFileSync(batchFile, [
      'plans:',
      '  - id: repo:plan',
      '    title: Plan',
    ].join('\n'));

    process.cwd = () => root;
    createBatchCommand(batchFile, {});

    expect(process.exitCode).toBe(1);
  });

  it('skips existing plans', () => {
    const { metaRoot, repos } = createBatchCliFixture([
      { alias: 'repo-a', plans: [{ id: 'existing', title: 'Existing', status: 'draft' }] },
    ]);

    const batchFile = join(metaRoot, 'batch.yaml');
    writeFileSync(batchFile, [
      'plans:',
      '  - id: repo-a:existing',
      '    title: Existing',
      '  - id: repo-a:new-one',
      '    title: New One',
    ].join('\n'));

    process.cwd = () => repos[0].root;
    createBatchCommand(batchFile, {});

    expect(existsSync(join(repos[0].plansDir, 'new-one', 'README.md'))).toBe(true);
  });

  it('JSON output works', () => {
    const { metaRoot, repos } = createBatchCliFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    const batchFile = join(metaRoot, 'batch.yaml');
    writeFileSync(batchFile, [
      'plans:',
      '  - id: repo-a:plan-a',
      '    title: Plan A',
    ].join('\n'));

    process.cwd = () => repos[0].root;
    createBatchCommand(batchFile, { json: true });

    // console.log should have been called with JSON
    const logCalls = (console.log as any).mock.calls;
    expect(logCalls.length).toBeGreaterThan(0);
    const output = JSON.parse(logCalls[0][0]);
    expect(output.created).toHaveLength(1);
    expect(output.created[0].id).toBe('repo-a:plan-a');
  });
});
