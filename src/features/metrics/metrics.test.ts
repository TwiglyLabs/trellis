import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { MetricsResult } from './logic.ts';
import type { PlanStatus } from '../../core/types.ts';

// --- Command tests (mock-based) ---

vi.mock('../../core/index.ts', async () => {
  const actual = await vi.importActual<typeof import('../../core/index.ts')>('../../core/index.ts');
  return {
    ...actual,
    createContext: vi.fn(),
  };
});

vi.mock('./logic.ts', async () => {
  const actual = await vi.importActual<typeof import('./logic.ts')>('./logic.ts');
  return {
    ...actual,
    computeMetrics: vi.fn(),
  };
});

import { metricsCommand } from './command.ts';
import { createContext } from '../../core/index.ts';
import { computeMetrics } from './logic.ts';
import { computeUpdate } from '../update/logic.ts';
import { computeSet } from '../set/logic.ts';

const MockCreateContext = vi.mocked(createContext);
const MockComputeMetrics = vi.mocked(computeMetrics);

describe('metrics command', () => {
  const logs: string[] = [];
  const errors: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
    MockCreateContext.mockReset();
    MockComputeMetrics.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  function mockContext(metricsResult?: MetricsResult | Error) {
    const ctx = {
      config: { project: 'test-project', plans_dir: 'plans' },
      projectDir: '/test',
      plansDir: '/test/plans',
      plans: [],
      graph: { nodes: [], edges: [], dependents: {}, dependencies: {} },
    } as any;

    MockCreateContext.mockReturnValue(ctx);

    if (metricsResult instanceof Error) {
      MockComputeMetrics.mockImplementation(() => { throw metricsResult; });
    } else if (metricsResult) {
      MockComputeMetrics.mockReturnValue(metricsResult);
    }

    return ctx;
  }

  it('shows empty message when no done plans', () => {
    mockContext({
      plans: [],
      total_completed: 0,
      median_cycle_time_hours: null,
      plans_per_epic: {},
    });

    metricsCommand({});

    expect(logs.join('\n')).toContain('No completed plans found');
  });

  it('renders plan table with metrics', () => {
    mockContext({
      plans: [{
        id: 'my-plan',
        title: 'My Plan',
        completed_at: '2026-02-10T12:00:00.000Z',
        cycle_time_hours: 2,
        queue_time_hours: 24,
        lines: 150,
        tags: ['foundation'],
        epic: 'v1',
        sessions: 2,
        deviation: 'minor',
      }],
      total_completed: 1,
      median_cycle_time_hours: 2,
      plans_per_epic: { v1: 1 },
    });

    metricsCommand({});

    const output = logs.join('\n');
    expect(output).toContain('my-plan');
    expect(output).toContain('150 lines');
    expect(output).toContain('2s');  // sessions
    expect(output).toContain('minor');
    expect(output).toContain('Median cycle time');
    expect(output).toContain('v1: 1');
  });

  it('outputs JSON', () => {
    const result: MetricsResult = {
      plans: [{
        id: 'plan-a',
        title: 'Plan A',
        completed_at: '2026-02-10T12:00:00.000Z',
        cycle_time_hours: 5.5,
        queue_time_hours: null,
        lines: 200,
        tags: ['foundation'],
        epic: null,
        sessions: null,
        deviation: null,
      }],
      total_completed: 1,
      median_cycle_time_hours: 5.5,
      plans_per_epic: {},
    };
    mockContext(result);

    metricsCommand({ json: true });

    const output = JSON.parse(logs.join(''));
    expect(output.plans).toHaveLength(1);
    expect(output.plans[0].id).toBe('plan-a');
    expect(output.plans[0].cycle_time_hours).toBe(5.5);
    expect(output.total_completed).toBe(1);
    expect(output.median_cycle_time_hours).toBe(5.5);
  });

  it('passes --since to computeMetrics()', () => {
    mockContext({
      plans: [],
      total_completed: 0,
      median_cycle_time_hours: null,
      plans_per_epic: {},
    });

    metricsCommand({ since: '2026-02-01' });

    expect(MockComputeMetrics).toHaveBeenCalledWith({ plans: [], since: '2026-02-01' });
  });

  it('handles errors in human-readable mode', () => {
    mockContext(new Error('Invalid date: "bad"'));

    metricsCommand({ since: 'bad' });

    expect(errors.join('\n')).toContain('Invalid date');
    expect(process.exitCode).toBe(1);
  });

  it('handles errors in JSON mode', () => {
    mockContext(new Error('Invalid date: "bad"'));

    metricsCommand({ json: true, since: 'bad' });

    const output = JSON.parse(errors.join(''));
    expect(output.error).toContain('Invalid date');
    expect(process.exitCode).toBe(1);
  });
});

// --- API tests ---

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

describe('not_started_at timestamp', () => {
  let tmpDir: string;
  let plansDir: string;
  let realCore: any;
  let realUpdate: any;

  beforeEach(async () => {
    realCore = await vi.importActual('../../core/index.ts');
    realUpdate = await vi.importActual('../update/logic.ts');
    const p = createTestProject();
    tmpDir = p.tmpDir;
    plansDir = p.plansDir;
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('auto-sets not_started_at when transitioning to not_started', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'draft' });
    const ctx = realCore.createContext(tmpDir);
    realUpdate.computeUpdate({ planId: 'a', status: 'not_started' as PlanStatus, graph: ctx.graph, force: true });

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain('not_started_at');
  });

  it('does not overwrite existing not_started_at', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    writePlan(plansDir, 'a', { title: 'A', status: 'draft', not_started_at: `'${ts}'` });
    const ctx = realCore.createContext(tmpDir);
    realUpdate.computeUpdate({ planId: 'a', status: 'not_started' as PlanStatus, graph: ctx.graph, force: true });

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain(ts);
  });

  it('clears not_started_at on backward transition to draft', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started', not_started_at: "'2026-02-01T00:00:00.000Z'" });
    const ctx = realCore.createContext(tmpDir);
    realUpdate.computeUpdate({ planId: 'a', status: 'draft' as PlanStatus, graph: ctx.graph, force: true });

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).not.toContain('not_started_at');
  });

  it('preserves not_started_at on forward transition to in_progress', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started', not_started_at: "'2026-02-01T00:00:00.000Z'" });
    const ctx = realCore.createContext(tmpDir);
    realUpdate.computeUpdate({ planId: 'a', status: 'in_progress' as PlanStatus, graph: ctx.graph, force: true });

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain('not_started_at');
    expect(content).toContain('started_at');
  });
});

describe('sessions and deviation fields (API)', () => {
  let tmpDir: string;
  let plansDir: string;
  let realCore: any;
  let realSet: any;

  beforeEach(async () => {
    realCore = await vi.importActual('../../core/index.ts');
    realSet = await vi.importActual('../set/logic.ts');
    const p = createTestProject();
    tmpDir = p.tmpDir;
    plansDir = p.plansDir;
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('sets sessions as a number via set()', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const ctx = realCore.createContext(tmpDir);
    const result = realSet.computeSet({ planId: 'a', field: 'sessions', value: '3', mode: 'replace', graph: ctx.graph });
    expect(result.value).toBe(3);

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain('sessions: 3');
  });

  it('rejects non-integer sessions', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const ctx = realCore.createContext(tmpDir);
    expect(() => realSet.computeSet({ planId: 'a', field: 'sessions', value: '1.5', mode: 'replace', graph: ctx.graph })).toThrow('positive integer');
  });

  it('rejects zero sessions', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const ctx = realCore.createContext(tmpDir);
    expect(() => realSet.computeSet({ planId: 'a', field: 'sessions', value: '0', mode: 'replace', graph: ctx.graph })).toThrow('positive integer');
  });

  it('rejects negative sessions', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const ctx = realCore.createContext(tmpDir);
    expect(() => realSet.computeSet({ planId: 'a', field: 'sessions', value: '-1', mode: 'replace', graph: ctx.graph })).toThrow('positive integer');
  });

  it('sets deviation via set()', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const ctx = realCore.createContext(tmpDir);
    const result = realSet.computeSet({ planId: 'a', field: 'deviation', value: 'minor', mode: 'replace', graph: ctx.graph });
    expect(result.value).toBe('minor');

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain('deviation: minor');
  });

  it('accepts all valid deviation values', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    let ctx = realCore.createContext(tmpDir);
    for (const val of ['none', 'minor', 'major']) {
      realSet.computeSet({ planId: 'a', field: 'deviation', value: val, mode: 'replace', graph: ctx.graph });
      const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
      expect(content).toContain(`deviation: ${val}`);
    }
  });

  it('rejects invalid deviation', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const ctx = realCore.createContext(tmpDir);
    expect(() => realSet.computeSet({ planId: 'a', field: 'deviation', value: 'huge', mode: 'replace', graph: ctx.graph })).toThrow('"none", "minor", or "major"');
  });
});

describe('computeMetrics integration', () => {
  let tmpDir: string;
  let plansDir: string;
  let realCore: any;
  let realMetrics: any;

  beforeEach(async () => {
    realCore = await vi.importActual('../../core/index.ts');
    realMetrics = await vi.importActual('./logic.ts');
    const p = createTestProject();
    tmpDir = p.tmpDir;
    plansDir = p.plansDir;
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('returns empty result with no done plans', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const ctx = realCore.createContext(tmpDir);
    const result = realMetrics.computeMetrics({ plans: ctx.plans });

    expect(result.plans).toEqual([]);
    expect(result.total_completed).toBe(0);
    expect(result.median_cycle_time_hours).toBeNull();
    expect(result.plans_per_epic).toEqual({});
  });

  it('computes cycle time from started_at and completed_at', () => {
    writePlan(plansDir, 'a', {
      title: 'A',
      status: 'done',
      started_at: "'2026-02-10T10:00:00.000Z'",
      completed_at: "'2026-02-10T12:00:00.000Z'",
    });
    const ctx = realCore.createContext(tmpDir);
    const result = realMetrics.computeMetrics({ plans: ctx.plans });

    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].cycle_time_hours).toBe(2);
  });

  it('computes queue time from not_started_at and started_at', () => {
    writePlan(plansDir, 'a', {
      title: 'A',
      status: 'done',
      not_started_at: "'2026-02-09T10:00:00.000Z'",
      started_at: "'2026-02-10T10:00:00.000Z'",
      completed_at: "'2026-02-10T12:00:00.000Z'",
    });
    const ctx = realCore.createContext(tmpDir);
    const result = realMetrics.computeMetrics({ plans: ctx.plans });

    expect(result.plans[0].queue_time_hours).toBe(24);
  });

  it('returns null for missing timestamps', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const ctx = realCore.createContext(tmpDir);
    const result = realMetrics.computeMetrics({ plans: ctx.plans });

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
    const ctx = realCore.createContext(tmpDir);
    const result = realMetrics.computeMetrics({ plans: ctx.plans });

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
    const ctx = realCore.createContext(tmpDir);
    const result = realMetrics.computeMetrics({ plans: ctx.plans });

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
    const ctx = realCore.createContext(tmpDir);
    const result = realMetrics.computeMetrics({ plans: ctx.plans });

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
    const ctx = realCore.createContext(tmpDir);
    const result = realMetrics.computeMetrics({ plans: ctx.plans, since: '2026-02-01' });

    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].id).toBe('new');
  });

  it('throws on invalid since date', () => {
    const ctx = realCore.createContext(tmpDir);
    expect(() => realMetrics.computeMetrics({ plans: ctx.plans, since: 'not-a-date' })).toThrow('Invalid date');
  });

  it('computes median cycle time', () => {
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
    const ctx = realCore.createContext(tmpDir);
    const result = realMetrics.computeMetrics({ plans: ctx.plans });

    expect(result.median_cycle_time_hours).toBe(4);
  });

  it('computes median for even count', () => {
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
    const ctx = realCore.createContext(tmpDir);
    const result = realMetrics.computeMetrics({ plans: ctx.plans });

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
    const ctx = realCore.createContext(tmpDir);
    const result = realMetrics.computeMetrics({ plans: ctx.plans });

    expect(result.plans_per_epic).toEqual({ v1: 2, v2: 1 });
  });

  it('returns null median when no plans have cycle time', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    const ctx = realCore.createContext(tmpDir);
    const result = realMetrics.computeMetrics({ plans: ctx.plans });

    expect(result.median_cycle_time_hours).toBeNull();
  });
});
