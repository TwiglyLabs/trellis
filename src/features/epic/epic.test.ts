import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { epicCommand } from './command.ts';
import { Trellis } from '../../api.ts';
import { createFixture } from '../../__tests__/helpers.ts';

// --- Command tests ---

describe('epic command', () => {
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

  it('lists all epics with completion stats', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', tags: ['epic:v1'] },
      { id: 'b', title: 'Plan B', status: 'in_progress', tags: ['epic:v1'] },
      { id: 'c', title: 'Plan C', status: 'not_started', tags: ['epic:v1'] },
      { id: 'd', title: 'Plan D', status: 'done', tags: ['epic:v2'] },
      { id: 'e', title: 'Plan E', status: 'done', tags: ['epic:v2'] },
      { id: 'f', title: 'Plan F', status: 'not_started' },
    ]);
    process.cwd = () => root;

    epicCommand({});

    const output = logs.join('\n');
    expect(output).toContain('v1');
    expect(output).toContain('1/3');
    expect(output).toContain('v2');
    expect(output).toContain('2/2');
  });

  it('shows message when no epics exist', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);
    process.cwd = () => root;

    epicCommand({});

    expect(logs.join('\n')).toContain('No epics found');
  });

  it('shows detail for a single epic', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', tags: ['epic:v1'] },
      { id: 'b', title: 'Plan B', status: 'in_progress', tags: ['epic:v1'] },
      { id: 'c', title: 'Plan C', status: 'not_started', tags: ['epic:v1'], depends_on: ['b'] },
    ]);
    process.cwd = () => root;

    epicCommand({}, 'v1');

    const output = logs.join('\n');
    expect(output).toContain('v1');
    expect(output).toContain('1/3');
    expect(output).toContain('Plan A');
    expect(output).toContain('Plan B');
    expect(output).toContain('Plan C');
  });

  it('shows single epic as JSON', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', tags: ['epic:v1'] },
      { id: 'b', title: 'Plan B', status: 'not_started', tags: ['epic:v1'] },
    ]);
    process.cwd = () => root;

    epicCommand({ json: true }, 'v1');

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.epic).toBe('v1');
    expect(parsed.total).toBe(2);
    expect(parsed.done).toBe(1);
    expect(parsed.plans).toHaveLength(2);
    expect(parsed.plans[0]).toHaveProperty('id');
    expect(parsed.plans[0]).toHaveProperty('status');
  });

  it('shows error for unknown epic', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', tags: ['epic:v1'] },
    ]);
    process.cwd = () => root;

    epicCommand({}, 'nonexistent');

    expect(errors.join('\n')).toContain('not found');
  });

  it('shows JSON error for unknown epic', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', tags: ['epic:v1'] },
    ]);
    process.cwd = () => root;

    epicCommand({ json: true }, 'nonexistent');

    const parsed = JSON.parse(errors.join(''));
    expect(parsed.error).toContain('not found');
  });

  it('lists epics as JSON', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', tags: ['epic:v1'] },
      { id: 'b', title: 'Plan B', status: 'not_started', tags: ['epic:v1'] },
    ]);
    process.cwd = () => root;

    epicCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].epic).toBe('v1');
    expect(parsed[0].total).toBe(2);
    expect(parsed[0].done).toBe(1);
    expect(parsed[0].progress).toBeCloseTo(0.5);
  });
});

// --- API tests ---

function createTestProject() {
  const tmpDir = join(tmpdir(), `trellis-epic-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('Trellis.epic()', () => {
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

  it('returns all epics when no name given', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done', tags: ['epic:v1'] });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', tags: ['epic:v1'] });
    writePlan(plansDir, 'c', { title: 'C', status: 'not_started', tags: ['epic:v2'] });

    const t = new Trellis(tmpDir);
    const result = t.epic();
    expect(result).toHaveLength(2);

    const v1 = result.find(e => e.epic === 'v1')!;
    expect(v1.total).toBe(2);
    expect(v1.done).toBe(1);
    expect(v1.progress).toBe(0.5);
  });

  it('returns single epic with plans when name given', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done', tags: ['epic:v1'] });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', tags: ['epic:v1'] });

    const t = new Trellis(tmpDir);
    const result = t.epic('v1');
    expect(result).toHaveLength(1);
    expect(result[0].plans).toHaveLength(2);
  });

  it('returns empty array for unknown epic', () => {
    const t = new Trellis(tmpDir);
    expect(t.epic('nonexistent')).toHaveLength(0);
  });
});
