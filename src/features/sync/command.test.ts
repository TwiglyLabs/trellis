import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SyncResult } from './logic.ts';

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
    computeSync: vi.fn(),
  };
});

import { syncCommand } from './command.ts';
import { createContext } from '../../core/index.ts';
import { computeSync } from './logic.ts';

const MockCreateContext = vi.mocked(createContext);
const MockComputeSync = vi.mocked(computeSync);

describe('sync command', () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const origCwd = process.cwd;

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
    MockCreateContext.mockReset();
    MockComputeSync.mockReset();
  });

  afterEach(() => {
    process.cwd = origCwd;
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  function mockContext(config: { manifest?: string }, projectDir: string = '/test') {
    const ctx = {
      config: { ...config, project: 'test-project', plans_dir: 'plans' },
      projectDir,
      plansDir: `${projectDir}/plans`,
      plans: [],
      graph: { nodes: [], edges: [], dependents: {}, dependencies: {} },
    } as any;

    MockCreateContext.mockReturnValue(ctx);
    return ctx;
  }

  function mockSyncResult(result: SyncResult | Error) {
    if (result instanceof Error) {
      MockComputeSync.mockRejectedValue(result);
    } else {
      MockComputeSync.mockResolvedValue(result);
    }
  }

  it('prints no-manifest error when nothing configured', async () => {
    mockContext({}, '/nonexistent');
    await syncCommand({});
    expect(errors.join('\n')).toContain('No manifest configured');
    expect(process.exitCode).toBe(1);
  });

  it('prints no-manifest error as JSON', async () => {
    mockContext({}, '/nonexistent');
    await syncCommand({ json: true });
    const output = JSON.parse(errors.join(''));
    expect(output.error).toContain('No manifest configured');
    expect(process.exitCode).toBe(1);
  });

  it('renders per-repo status on success', async () => {
    mockContext({ manifest: 'git@github.com:org/meta.git' });
    mockSyncResult({
      project: 'myorg',
      totalPlans: 5,
      totalRepos: 2,
      successfulRepos: 2,
      durationMs: 1234,
      repos: [
        { alias: 'canopy', status: 'ok', planCount: 3, durationMs: 200 },
        { alias: 'acorn', status: 'ok', planCount: 2, durationMs: 300 },
      ],
    });

    await syncCommand({});

    const output = logs.join('\n');
    expect(output).toContain('Fetching 2 repos');
    expect(output).toContain('canopy');
    expect(output).toContain('3 plans');
    expect(output).toContain('acorn');
    expect(output).toContain('2 plans');
    expect(output).toContain('Synced 5 plans from 2/2 repos in 1.2s');
    expect(process.exitCode).toBeUndefined();
  });

  it('renders partial failures', async () => {
    mockContext({ manifest: 'git@github.com:org/meta.git' });
    mockSyncResult({
      project: 'myorg',
      totalPlans: 3,
      totalRepos: 2,
      successfulRepos: 1,
      durationMs: 2000,
      repos: [
        { alias: 'canopy', status: 'ok', planCount: 3, durationMs: 200 },
        { alias: 'acorn', status: 'error', planCount: 0, error: 'network timeout', durationMs: 5000 },
      ],
    });

    await syncCommand({});

    const output = logs.join('\n');
    expect(output).toContain('canopy');
    expect(output).toContain('acorn');
    expect(output).toContain('network timeout');
    expect(output).toContain('Synced 3 plans from 1/2 repos');
    // At least one success → exit code 0
    expect(process.exitCode).toBeUndefined();
  });

  it('sets exit code 1 when all repos fail', async () => {
    mockContext({ manifest: 'git@github.com:org/meta.git' });
    mockSyncResult({
      project: 'myorg',
      totalPlans: 0,
      totalRepos: 2,
      successfulRepos: 0,
      durationMs: 500,
      repos: [
        { alias: 'canopy', status: 'error', planCount: 0, error: 'auth failed', durationMs: 100 },
        { alias: 'acorn', status: 'error', planCount: 0, error: 'timeout', durationMs: 200 },
      ],
    });

    await syncCommand({});

    expect(process.exitCode).toBe(1);
  });

  it('outputs structured JSON with --json', async () => {
    mockContext({ manifest: 'git@github.com:org/meta.git' });
    mockSyncResult({
      project: 'myorg',
      totalPlans: 3,
      totalRepos: 2,
      successfulRepos: 2,
      durationMs: 1000,
      repos: [
        { alias: 'canopy', status: 'ok', planCount: 2, durationMs: 300 },
        { alias: 'acorn', status: 'ok', planCount: 1, durationMs: 400 },
      ],
    });

    await syncCommand({ json: true });

    const output = JSON.parse(logs.join(''));
    expect(output.project).toBe('myorg');
    expect(output.total_plans).toBe(3);
    expect(output.total_repos).toBe(2);
    expect(output.successful_repos).toBe(2);
    expect(output.duration_ms).toBe(1000);
    expect(output.repos).toHaveLength(2);
    expect(output.repos[0]).toEqual({
      alias: 'canopy',
      status: 'ok',
      plan_count: 2,
      duration_ms: 300,
    });
  });

  it('outputs JSON with error details on partial failure', async () => {
    mockContext({ manifest: 'git@github.com:org/meta.git' });
    mockSyncResult({
      project: 'myorg',
      totalPlans: 1,
      totalRepos: 2,
      successfulRepos: 1,
      durationMs: 500,
      repos: [
        { alias: 'canopy', status: 'ok', planCount: 1, durationMs: 100 },
        { alias: 'acorn', status: 'error', planCount: 0, error: 'auth failed', durationMs: 200 },
      ],
    });

    await syncCommand({ json: true });

    const output = JSON.parse(logs.join(''));
    expect(output.repos[1]).toEqual({
      alias: 'acorn',
      status: 'error',
      plan_count: 0,
      duration_ms: 200,
      error: 'auth failed',
    });
  });

  it('handles computeSync error in human-readable mode', async () => {
    mockContext({ manifest: 'git@github.com:org/meta.git' });
    mockSyncResult(new Error('Failed to discover project manifest. Check manifest URL and network access.'));

    await syncCommand({});

    expect(errors.join('\n')).toContain('Failed to discover project manifest');
    expect(process.exitCode).toBe(1);
  });

  it('handles computeSync error in JSON mode', async () => {
    mockContext({ manifest: 'git@github.com:org/meta.git' });
    mockSyncResult(new Error('Failed to discover project manifest.'));

    await syncCommand({ json: true });

    const output = JSON.parse(errors.join(''));
    expect(output.error).toContain('Failed to discover project manifest');
    expect(process.exitCode).toBe(1);
  });

  it('passes --repo flag to computeSync', async () => {
    mockContext({ manifest: 'git@github.com:org/meta.git' });
    mockSyncResult({
      project: 'myorg',
      totalPlans: 1,
      totalRepos: 1,
      successfulRepos: 1,
      durationMs: 200,
      repos: [
        { alias: 'canopy', status: 'ok', planCount: 1, durationMs: 100 },
      ],
    });

    await syncCommand({ repo: 'canopy' });

    expect(MockComputeSync).toHaveBeenCalledWith(expect.objectContaining({
      repo: 'canopy',
    }));
  });

  it('prints "nothing to sync" when no repos', async () => {
    mockContext({ manifest: 'git@github.com:org/meta.git' });
    mockSyncResult({
      project: 'myorg',
      totalPlans: 0,
      totalRepos: 0,
      successfulRepos: 0,
      durationMs: 50,
      repos: [],
    });

    await syncCommand({});

    expect(logs.join('\n')).toContain('Nothing to sync');
    expect(process.exitCode).toBeUndefined();
  });
});
