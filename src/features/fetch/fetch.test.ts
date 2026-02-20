import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture } from '../../__tests__/helpers.ts';
import type { FetchResult } from './logic.ts';

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
    computeFetch: vi.fn(),
  };
});

import { fetchCommand } from './command.ts';
import { createContext } from '../../core/index.ts';
import { computeFetch } from './logic.ts';

const MockCreateContext = vi.mocked(createContext);
const MockComputeFetch = vi.mocked(computeFetch);

describe('fetch command', () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const origCwd = process.cwd;

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
    MockCreateContext.mockReset();
    MockComputeFetch.mockReset();
  });

  afterEach(() => {
    process.cwd = origCwd;
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  function mockContext(config: { manifest?: string }, fetchResult?: FetchResult | Error) {
    const ctx = {
      config: { ...config, project: 'test-project', plans_dir: 'plans' },
      projectDir: '/test',
      plansDir: '/test/plans',
      plans: [],
      graph: { nodes: [], edges: [], dependents: {}, dependencies: {} },
    } as any;

    MockCreateContext.mockReturnValue(ctx);

    if (fetchResult instanceof Error) {
      MockComputeFetch.mockImplementation(() => { throw fetchResult; });
    } else if (fetchResult) {
      MockComputeFetch.mockReturnValue(fetchResult);
    }

    return ctx;
  }

  it('prints no-manifest message when manifest is not configured', () => {
    mockContext({});
    fetchCommand({});
    expect(errors.join('\n')).toContain('No manifest configured');
    expect(process.exitCode).toBe(1);
  });

  it('prints no-manifest message as JSON', () => {
    mockContext({});
    fetchCommand({ json: true });
    const output = JSON.parse(errors.join(''));
    expect(output.error).toContain('No manifest configured');
    expect(process.exitCode).toBe(1);
  });

  it('reports per-repo status on success', () => {
    mockContext({ manifest: 'git@github.com:org/meta.git' }, {
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
    mockContext({ manifest: 'git@github.com:org/meta.git' }, {
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
    mockContext({ manifest: 'git@github.com:org/meta.git' }, {
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
    mockContext({ manifest: 'git@github.com:org/meta.git' }, {
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
    mockContext(
      { manifest: 'git@github.com:org/meta.git' },
      new Error('Failed to discover project manifest. Check manifest URL and network access.'),
    );

    fetchCommand({});

    expect(errors.join('\n')).toContain('Failed to discover project manifest');
    expect(process.exitCode).toBe(1);
  });

  it('handles fetch error in JSON mode', () => {
    mockContext(
      { manifest: 'git@github.com:org/meta.git' },
      new Error('Failed to discover project manifest. Check manifest URL and network access.'),
    );

    fetchCommand({ json: true });

    const output = JSON.parse(errors.join(''));
    expect(output.error).toContain('Failed to discover project manifest');
    expect(process.exitCode).toBe(1);
  });
});
