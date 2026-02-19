import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MetricsResult } from '../../src/api.ts';

vi.mock('../../src/api.ts', async () => {
  const actual = await vi.importActual<typeof import('../../src/api.ts')>('../../src/api.ts');
  return {
    ...actual,
    Trellis: vi.fn(),
  };
});

import { metricsCommand } from '../../src/commands/metrics.ts';
import { Trellis } from '../../src/api.ts';

const MockTrellis = vi.mocked(Trellis);

describe('metrics command', () => {
  const logs: string[] = [];
  const errors: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
    MockTrellis.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  function mockTrellis(metricsResult?: MetricsResult | Error) {
    const instance = { metrics: vi.fn() } as any;
    if (metricsResult instanceof Error) {
      instance.metrics.mockImplementation(() => { throw metricsResult; });
    } else if (metricsResult) {
      instance.metrics.mockReturnValue(metricsResult);
    }
    MockTrellis.mockReturnValue(instance);
    return instance;
  }

  it('shows empty message when no done plans', () => {
    mockTrellis({
      plans: [],
      total_completed: 0,
      median_cycle_time_hours: null,
      plans_per_epic: {},
    });

    metricsCommand({});

    expect(logs.join('\n')).toContain('No completed plans found');
  });

  it('renders plan table with metrics', () => {
    mockTrellis({
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
    mockTrellis(result);

    metricsCommand({ json: true });

    const output = JSON.parse(logs.join(''));
    expect(output.plans).toHaveLength(1);
    expect(output.plans[0].id).toBe('plan-a');
    expect(output.plans[0].cycle_time_hours).toBe(5.5);
    expect(output.total_completed).toBe(1);
    expect(output.median_cycle_time_hours).toBe(5.5);
  });

  it('passes --since to metrics()', () => {
    const instance = mockTrellis({
      plans: [],
      total_completed: 0,
      median_cycle_time_hours: null,
      plans_per_epic: {},
    });

    metricsCommand({ since: '2026-02-01' });

    expect(instance.metrics).toHaveBeenCalledWith({ since: '2026-02-01' });
  });

  it('handles errors in human-readable mode', () => {
    mockTrellis(new Error('Invalid date: "bad"'));

    metricsCommand({ since: 'bad' });

    expect(errors.join('\n')).toContain('Invalid date');
    expect(process.exitCode).toBe(1);
  });

  it('handles errors in JSON mode', () => {
    mockTrellis(new Error('Invalid date: "bad"'));

    metricsCommand({ json: true, since: 'bad' });

    const output = JSON.parse(errors.join(''));
    expect(output.error).toContain('Invalid date');
    expect(process.exitCode).toBe(1);
  });
});
