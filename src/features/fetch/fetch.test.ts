import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture } from '../../__tests__/helpers.ts';
import type { FetchResult } from '../../api.ts';

vi.mock('../../api.ts', async () => {
  const actual = await vi.importActual<typeof import('../../api.ts')>('../../api.ts');
  return {
    ...actual,
    Trellis: vi.fn(),
  };
});

import { fetchCommand } from './command.ts';
import { Trellis } from '../../api.ts';

const MockTrellis = vi.mocked(Trellis);

describe('fetch command', () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const origCwd = process.cwd;

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
    MockTrellis.mockReset();
  });

  afterEach(() => {
    process.cwd = origCwd;
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  function mockTrellis(config: { manifest?: string }, fetchResult?: FetchResult | Error) {
    const instance = { config, fetch: vi.fn() } as any;
    if (fetchResult instanceof Error) {
      instance.fetch.mockImplementation(() => { throw fetchResult; });
    } else if (fetchResult) {
      instance.fetch.mockReturnValue(fetchResult);
    }
    MockTrellis.mockReturnValue(instance);
    return instance;
  }

  it('prints no-manifest message when manifest is not configured', () => {
    mockTrellis({});
    fetchCommand({});
    expect(errors.join('\n')).toContain('No manifest configured');
    expect(process.exitCode).toBe(1);
  });

  it('prints no-manifest message as JSON', () => {
    mockTrellis({});
    fetchCommand({ json: true });
    const output = JSON.parse(errors.join(''));
    expect(output.error).toContain('No manifest configured');
    expect(process.exitCode).toBe(1);
  });

  it('reports per-repo status on success', () => {
    mockTrellis({ manifest: 'git@github.com:org/meta.git' }, {
      project: 'myproject',
      totalPlans: 5,
      repos: [
        { alias: 'canopy', ok: true, planCount: 3 },
        { alias: 'acorn', ok: true, planCount: 2 },
      ],
    });

    fetchCommand({});

    const output = logs.join('\n');
    expect(output).toContain('myproject');
    expect(output).toContain('5 remote plans');
    expect(output).toContain('canopy');
    expect(output).toContain('3 plans');
    expect(output).toContain('acorn');
    expect(output).toContain('2 plans');
    expect(process.exitCode).toBeUndefined();
  });

  it('renders partial failures in human-readable output', () => {
    mockTrellis({ manifest: 'git@github.com:org/meta.git' }, {
      project: 'myproject',
      totalPlans: 2,
      repos: [
        { alias: 'canopy', ok: true, planCount: 2 },
        { alias: 'acorn', ok: false, planCount: 0, error: 'Failed to fetch plans from "acorn"' },
      ],
    });

    fetchCommand({});

    const output = logs.join('\n');
    expect(output).toContain('canopy');
    expect(output).toContain('acorn');
    expect(output).toContain('failed');
    expect(process.exitCode).toBeUndefined();
  });

  it('outputs JSON on success with --json', () => {
    mockTrellis({ manifest: 'git@github.com:org/meta.git' }, {
      project: 'myproject',
      totalPlans: 3,
      repos: [
        { alias: 'canopy', ok: true, planCount: 2 },
        { alias: 'acorn', ok: true, planCount: 1 },
      ],
    });

    fetchCommand({ json: true });

    const output = JSON.parse(logs.join(''));
    expect(output.project).toBe('myproject');
    expect(output.total_plans).toBe(3);
    expect(output.repos).toHaveLength(2);
    expect(output.repos[0]).toEqual({ alias: 'canopy', ok: true, plan_count: 2 });
    expect(output.repos[1]).toEqual({ alias: 'acorn', ok: true, plan_count: 1 });
  });

  it('outputs JSON with partial failures', () => {
    mockTrellis({ manifest: 'git@github.com:org/meta.git' }, {
      project: 'myproject',
      totalPlans: 1,
      repos: [
        { alias: 'canopy', ok: true, planCount: 1 },
        { alias: 'acorn', ok: false, planCount: 0, error: 'Failed to fetch plans from "acorn"' },
      ],
    });

    fetchCommand({ json: true });

    const output = JSON.parse(logs.join(''));
    expect(output.repos[1]).toEqual({
      alias: 'acorn',
      ok: false,
      plan_count: 0,
      error: 'Failed to fetch plans from "acorn"',
    });
  });

  it('handles fetch error in human-readable mode', () => {
    mockTrellis(
      { manifest: 'git@github.com:org/meta.git' },
      new Error('Failed to discover project manifest. Check manifest URL and network access.'),
    );

    fetchCommand({});

    expect(errors.join('\n')).toContain('Failed to discover project manifest');
    expect(process.exitCode).toBe(1);
  });

  it('handles fetch error in JSON mode', () => {
    mockTrellis(
      { manifest: 'git@github.com:org/meta.git' },
      new Error('Failed to discover project manifest. Check manifest URL and network access.'),
    );

    fetchCommand({ json: true });

    const output = JSON.parse(errors.join(''));
    expect(output.error).toContain('Failed to discover project manifest');
    expect(process.exitCode).toBe(1);
  });
});
