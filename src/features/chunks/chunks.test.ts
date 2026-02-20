import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { chunksCommand } from './command.ts';
import { Trellis } from '../../api.ts';
import { createFixture } from '../../__tests__/helpers.ts';

// --- Command tests ---

describe('chunks command', () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const origCwd = process.cwd;

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
  });

  afterEach(() => {
    process.cwd = origCwd;
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('shows message when no plans found', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    chunksCommand({});

    expect(logs.join('\n')).toContain('No plans found.');
  });

  it('shows empty JSON when no plans found', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    chunksCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.chunks).toEqual([]);
    expect(parsed.crossChunkEdges).toEqual([]);
  });

  it('groups a single plan into one chunk', () => {
    const { root } = createFixture([
      { id: 'standalone', title: 'Standalone', status: 'not_started' },
    ]);
    process.cwd = () => root;

    chunksCommand({});

    const output = logs.join('\n');
    expect(output).toContain('1 discovered');
    expect(output).toContain('standalone');
  });

  it('groups plans by directory', () => {
    const { root } = createFixture([
      { id: 'contracts/core', title: 'Core', status: 'not_started' },
      { id: 'contracts/auth', title: 'Auth', status: 'not_started' },
      { id: 'impl/parser', title: 'Parser', status: 'not_started' },
    ]);
    process.cwd = () => root;

    chunksCommand({});

    const output = logs.join('\n');
    expect(output).toContain('contracts');
    expect(output).toContain('impl');
  });

  it('outputs valid JSON matching schema', () => {
    const { root } = createFixture([
      { id: 'contracts/core', title: 'Core', status: 'not_started' },
      { id: 'contracts/auth', title: 'Auth', status: 'not_started', depends_on: ['contracts/core'] },
    ]);
    process.cwd = () => root;

    chunksCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.chunks).toHaveLength(1);
    expect(parsed.chunks[0].id).toBe('contracts');
    expect(parsed.chunks[0].planCount).toBe(2);
    expect(parsed.chunks[0].plans[0]).toHaveProperty('id');
    expect(parsed.chunks[0].plans[0]).toHaveProperty('filePath');
    expect(parsed.chunks[0].plans[0]).toHaveProperty('lines');
    expect(parsed.chunks[0]).toHaveProperty('roots');
    expect(parsed.chunks[0]).toHaveProperty('leaves');
    expect(parsed.chunks[0]).toHaveProperty('internalEdges');
    expect(parsed.config).toHaveProperty('maxLines');
    expect(parsed.config).toHaveProperty('overrides');
  });

  it('shows cross-chunk edges with --verbose', () => {
    const { root } = createFixture([
      { id: 'contracts/core', title: 'Core', status: 'not_started' },
      { id: 'impl/parser', title: 'Parser', status: 'not_started', depends_on: ['contracts/core'] },
    ]);
    process.cwd = () => root;

    chunksCommand({ verbose: true });

    const output = logs.join('\n');
    expect(output).toContain('Cross-chunk edges');
    expect(output).toContain('contracts/core');
  });

  it('does not show cross-chunk edges without --verbose', () => {
    const { root } = createFixture([
      { id: 'contracts/core', title: 'Core', status: 'not_started' },
      { id: 'impl/parser', title: 'Parser', status: 'not_started', depends_on: ['contracts/core'] },
    ]);
    process.cwd = () => root;

    chunksCommand({});

    const output = logs.join('\n');
    expect(output).not.toContain('Cross-chunk edges');
  });

  it('places chunk:name override plan in named chunk', () => {
    const { root } = createFixture([
      { id: 'contracts/core', title: 'Core', status: 'not_started', tags: ['chunk:special'] },
      { id: 'contracts/auth', title: 'Auth', status: 'not_started' },
      { id: 'impl/parser', title: 'Parser', status: 'not_started' },
    ]);
    process.cwd = () => root;

    chunksCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    const special = parsed.chunks.find((c: any) => c.id === 'special');
    expect(special).toBeDefined();
    expect(special.plans.some((p: any) => p.id === 'contracts/core')).toBe(true);
  });

  it('warns on stderr for over-budget chunks', () => {
    // Create a plan with large body that exceeds a tight budget
    const { root } = createFixture([
      { id: 'big', title: 'Big Plan', status: 'not_started', body: 'x\n'.repeat(100) },
    ]);
    // Write a config with tiny chunk_max_lines
    const { writeFileSync: wfs } = require('fs');
    const { join: jn } = require('path');
    wfs(jn(root, '.trellis'), 'project: test\nplans_dir: plans\nchunk_max_lines: 10\n');
    process.cwd = () => root;

    chunksCommand({});

    expect(errors.some(e => e.includes('exceeds line budget'))).toBe(true);
  });

  it('keeps unconnected directories separate', () => {
    const { root } = createFixture([
      { id: 'contracts/core', title: 'Core', status: 'not_started' },
      { id: 'impl/parser', title: 'Parser', status: 'not_started' },
    ]);
    process.cwd = () => root;

    chunksCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.chunks).toHaveLength(2);
  });

  it('accepts --strategy CLI override', () => {
    const { root } = createFixture([
      { id: 'impl/core', title: 'Core', status: 'not_started' },
      { id: 'impl/auth', title: 'Auth', status: 'not_started' },
      { id: 'impl/parser', title: 'Parser', status: 'not_started', depends_on: ['impl/core'] },
    ]);
    process.cwd = () => root;

    // Verify the command accepts the strategy option without errors
    chunksCommand({ json: true, strategy: 'directory' });
    const dirResult = JSON.parse(logs.join(''));
    expect(dirResult.chunks).toHaveLength(1);
    expect(dirResult.chunks[0].id).toBe('impl');

    logs.length = 0;

    // Verify topological strategy is accepted (implementation pending)
    chunksCommand({ json: true, strategy: 'topological' });
    const topoResult = JSON.parse(logs.join(''));
    // For now, both strategies may produce same result until topological is implemented
    expect(topoResult.chunks.length).toBeGreaterThanOrEqual(1);
  });
});

// --- API tests ---

function createTestProject() {
  const tmpDir = join(tmpdir(), `trellis-chunks-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const plansDir = join(tmpDir, 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');
  return { tmpDir, plansDir };
}

function writePlan(plansDir: string, id: string, frontmatter: Record<string, unknown>, body?: string) {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - ${i}`).join('\n')}`;
      return `${k}: ${v}`;
    })
    .join('\n');
  const planDir = join(plansDir, id);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, 'README.md'), `---\n${fm}\n---\n${body ?? `\nBody for ${id}\n`}`);
}

describe('Trellis.chunks()', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('filters by tag and repo', () => {
    writePlan(plansDir, 'contracts/types', { title: 'Types', status: 'done', tags: ['foundation'], repo: 'public' });
    writePlan(plansDir, 'impl/core', { title: 'Core', status: 'not_started', tags: ['core'], repo: 'private' });

    const t = new Trellis(tmpDir);
    const byTag = t.chunks({ tag: 'foundation' });
    const planIds = byTag.chunks.flatMap(c => c.plans.map(p => p.id));
    expect(planIds).toContain('contracts/types');
    expect(planIds).not.toContain('impl/core');
  });

  it('returns chunk result', () => {
    writePlan(plansDir, 'contracts/types', { title: 'Types', status: 'done' });
    writePlan(plansDir, 'contracts/api', { title: 'API', status: 'not_started', depends_on: ['contracts/types'] });
    writePlan(plansDir, 'impl/core', { title: 'Core', status: 'not_started', depends_on: ['contracts/types'] });

    const t = new Trellis(tmpDir);
    const result = t.chunks();
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(Array.isArray(result.crossChunkEdges)).toBe(true);
    expect(typeof result.config.maxLines).toBe('number');
  });
});
