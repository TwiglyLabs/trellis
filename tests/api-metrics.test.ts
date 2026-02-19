import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Trellis } from '../src/api.ts';

function createTestProject() {
  const tmpDir = join(tmpdir(), `trellis-metrics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

// --- not_started_at auto-set/clear ---

describe('not_started_at timestamp', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const p = createTestProject();
    tmpDir = p.tmpDir;
    plansDir = p.plansDir;
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('auto-sets not_started_at when transitioning to not_started', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'draft' });
    const t = new Trellis(tmpDir);
    t.update('a', 'not_started', { force: true });

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain('not_started_at');
  });

  it('does not overwrite existing not_started_at', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    writePlan(plansDir, 'a', { title: 'A', status: 'draft', not_started_at: `'${ts}'` });
    const t = new Trellis(tmpDir);
    t.update('a', 'not_started', { force: true });

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain(ts);
  });

  it('clears not_started_at on backward transition to draft', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started', not_started_at: "'2026-02-01T00:00:00.000Z'" });
    const t = new Trellis(tmpDir);
    t.update('a', 'draft', { force: true });

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).not.toContain('not_started_at');
  });

  it('preserves not_started_at on forward transition to in_progress', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started', not_started_at: "'2026-02-01T00:00:00.000Z'" });
    const t = new Trellis(tmpDir);
    t.update('a', 'in_progress', { force: true });

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain('not_started_at');
    expect(content).toContain('started_at');
  });
});

// --- sessions and deviation via set() ---

describe('sessions and deviation fields', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const p = createTestProject();
    tmpDir = p.tmpDir;
    plansDir = p.plansDir;
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('sets sessions as a number via set()', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const t = new Trellis(tmpDir);
    const result = t.set('a', 'sessions', '3');
    expect(result.value).toBe(3);

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain('sessions: 3');
  });

  it('rejects non-integer sessions', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const t = new Trellis(tmpDir);
    expect(() => t.set('a', 'sessions', '1.5')).toThrow('positive integer');
  });

  it('rejects zero sessions', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const t = new Trellis(tmpDir);
    expect(() => t.set('a', 'sessions', '0')).toThrow('positive integer');
  });

  it('rejects negative sessions', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const t = new Trellis(tmpDir);
    expect(() => t.set('a', 'sessions', '-1')).toThrow('positive integer');
  });

  it('sets deviation via set()', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const t = new Trellis(tmpDir);
    const result = t.set('a', 'deviation', 'minor');
    expect(result.value).toBe('minor');

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain('deviation: minor');
  });

  it('accepts all valid deviation values', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const t = new Trellis(tmpDir);
    for (const val of ['none', 'minor', 'major']) {
      t.set('a', 'deviation', val);
      const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
      expect(content).toContain(`deviation: ${val}`);
    }
  });

  it('rejects invalid deviation', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const t = new Trellis(tmpDir);
    expect(() => t.set('a', 'deviation', 'huge')).toThrow('"none", "minor", or "major"');
  });
});

// --- metrics() ---

describe('Trellis.metrics()', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const p = createTestProject();
    tmpDir = p.tmpDir;
    plansDir = p.plansDir;
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('returns empty result with no done plans', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const t = new Trellis(tmpDir);
    const result = t.metrics();

    expect(result.plans).toEqual([]);
    expect(result.total_completed).toBe(0);
    expect(result.median_cycle_time_hours).toBeNull();
    expect(result.plans_per_epic).toEqual({});
  });

  it('computes cycle time from started_at and completed_at', () => {
    // 2 hours difference
    writePlan(plansDir, 'a', {
      title: 'A',
      status: 'done',
      started_at: "'2026-02-10T10:00:00.000Z'",
      completed_at: "'2026-02-10T12:00:00.000Z'",
    });
    const t = new Trellis(tmpDir);
    const result = t.metrics();

    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].cycle_time_hours).toBe(2);
  });

  it('computes queue time from not_started_at and started_at', () => {
    // 24 hours in queue
    writePlan(plansDir, 'a', {
      title: 'A',
      status: 'done',
      not_started_at: "'2026-02-09T10:00:00.000Z'",
      started_at: "'2026-02-10T10:00:00.000Z'",
      completed_at: "'2026-02-10T12:00:00.000Z'",
    });
    const t = new Trellis(tmpDir);
    const result = t.metrics();

    expect(result.plans[0].queue_time_hours).toBe(24);
  });

  it('returns null for missing timestamps', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const t = new Trellis(tmpDir);
    const result = t.metrics();

    expect(result.plans[0].cycle_time_hours).toBeNull();
    expect(result.plans[0].queue_time_hours).toBeNull();
  });

  it('includes line count, tags, and epic', () => {
    writePlan(plansDir, 'a', {
      title: 'A',
      status: 'done',
      tags: ['foundation', 'epic:v1'],
      completed_at: "'2026-02-10T12:00:00.000Z'",
    });
    const t = new Trellis(tmpDir);
    const result = t.metrics();

    expect(result.plans[0].tags).toEqual(['foundation', 'epic:v1']);
    expect(result.plans[0].epic).toBe('v1');
    expect(result.plans[0].lines).toBeGreaterThan(0);
  });

  it('includes sessions and deviation', () => {
    writePlan(plansDir, 'a', {
      title: 'A',
      status: 'done',
      sessions: 3,
      deviation: 'minor',
      completed_at: "'2026-02-10T12:00:00.000Z'",
    });
    const t = new Trellis(tmpDir);
    const result = t.metrics();

    expect(result.plans[0].sessions).toBe(3);
    expect(result.plans[0].deviation).toBe('minor');
  });

  it('sorts by completion date newest first', () => {
    writePlan(plansDir, 'old', {
      title: 'Old', status: 'done',
      completed_at: "'2026-02-01T00:00:00.000Z'",
    });
    writePlan(plansDir, 'new', {
      title: 'New', status: 'done',
      completed_at: "'2026-02-10T00:00:00.000Z'",
    });
    const t = new Trellis(tmpDir);
    const result = t.metrics();

    expect(result.plans[0].id).toBe('new');
    expect(result.plans[1].id).toBe('old');
  });

  it('filters by --since date', () => {
    writePlan(plansDir, 'old', {
      title: 'Old', status: 'done',
      completed_at: "'2026-01-15T00:00:00.000Z'",
    });
    writePlan(plansDir, 'new', {
      title: 'New', status: 'done',
      completed_at: "'2026-02-10T00:00:00.000Z'",
    });
    const t = new Trellis(tmpDir);
    const result = t.metrics({ since: '2026-02-01' });

    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].id).toBe('new');
  });

  it('throws on invalid since date', () => {
    const t = new Trellis(tmpDir);
    expect(() => t.metrics({ since: 'not-a-date' })).toThrow('Invalid date');
  });

  it('computes median cycle time', () => {
    // 2h, 4h, 10h -> median = 4
    writePlan(plansDir, 'a', {
      title: 'A', status: 'done',
      started_at: "'2026-02-10T10:00:00.000Z'",
      completed_at: "'2026-02-10T12:00:00.000Z'",
    });
    writePlan(plansDir, 'b', {
      title: 'B', status: 'done',
      started_at: "'2026-02-10T10:00:00.000Z'",
      completed_at: "'2026-02-10T14:00:00.000Z'",
    });
    writePlan(plansDir, 'c', {
      title: 'C', status: 'done',
      started_at: "'2026-02-10T10:00:00.000Z'",
      completed_at: "'2026-02-10T20:00:00.000Z'",
    });
    const t = new Trellis(tmpDir);
    const result = t.metrics();

    expect(result.median_cycle_time_hours).toBe(4);
  });

  it('computes median for even count', () => {
    // 2h, 4h -> median = 3
    writePlan(plansDir, 'a', {
      title: 'A', status: 'done',
      started_at: "'2026-02-10T10:00:00.000Z'",
      completed_at: "'2026-02-10T12:00:00.000Z'",
    });
    writePlan(plansDir, 'b', {
      title: 'B', status: 'done',
      started_at: "'2026-02-10T10:00:00.000Z'",
      completed_at: "'2026-02-10T14:00:00.000Z'",
    });
    const t = new Trellis(tmpDir);
    const result = t.metrics();

    expect(result.median_cycle_time_hours).toBe(3);
  });

  it('computes plans per epic', () => {
    writePlan(plansDir, 'a', {
      title: 'A', status: 'done',
      tags: ['epic:v1'],
      completed_at: "'2026-02-10T00:00:00.000Z'",
    });
    writePlan(plansDir, 'b', {
      title: 'B', status: 'done',
      tags: ['epic:v1'],
      completed_at: "'2026-02-10T00:00:00.000Z'",
    });
    writePlan(plansDir, 'c', {
      title: 'C', status: 'done',
      tags: ['epic:v2'],
      completed_at: "'2026-02-10T00:00:00.000Z'",
    });
    const t = new Trellis(tmpDir);
    const result = t.metrics();

    expect(result.plans_per_epic).toEqual({ v1: 2, v2: 1 });
  });

  it('returns null median when no plans have cycle time', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const t = new Trellis(tmpDir);
    const result = t.metrics();

    expect(result.median_cycle_time_hours).toBeNull();
  });
});
