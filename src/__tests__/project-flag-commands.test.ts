import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Plan, ProjectManifest, TrellisConfig } from '../core/types.ts';
import type { GraphData } from '../core/graph.ts';

// Mock createCachedContext and createContext so we can inject remote plans + manifest
vi.mock('../core/index.ts', async () => {
  const actual = await vi.importActual<typeof import('../core/index.ts')>('../core/index.ts');
  return {
    ...actual,
    createCachedContext: vi.fn(),
    createContext: vi.fn(),
  };
});

import { createCachedContext, createContext, mergeWithRemote, buildGraph } from '../core/index.ts';
import { buildReposArray } from '../core/utils.ts';
import { statusCommand } from '../features/status/command.ts';
import { readyCommand } from '../features/ready/command.ts';
import { graphCommand } from '../features/graph/command.ts';
import { lintCommand } from '../features/lint/command.ts';
import { epicCommand } from '../features/epic/command.ts';
import { chunksCommand } from '../features/chunks/command.ts';

const MockCreateCachedContext = vi.mocked(createCachedContext);
const MockCreateContext = vi.mocked(createContext);

// --- Helpers ---

function makePlan(id: string, opts: {
  status?: string;
  depends_on?: string[];
  repoAlias?: string;
  tags?: string[];
  lineCount?: number;
} = {}): Plan {
  return {
    id,
    filePath: opts.repoAlias
      ? `trellis/${opts.repoAlias}/main:plans/${id}/README.md`
      : `plans/${id}/README.md`,
    frontmatter: {
      title: `Plan ${id}`,
      status: (opts.status ?? 'not_started') as any,
      depends_on: opts.depends_on,
      tags: opts.tags,
    },
    body: '',
    lineCount: opts.lineCount ?? 10,
    updatedAt: new Date(),
    fileHashes: {},
    repoAlias: opts.repoAlias,
  };
}

const testManifest: ProjectManifest = {
  name: 'test-project',
  repos: {
    myproject: { url: 'x', branch: 'main', visibility: 'public' },
    canopy: { url: 'y', branch: 'main', visibility: 'public' },
  },
};

const testConfig: TrellisConfig = { project: 'myproject', plans_dir: 'plans' };

function setupContext(plans: Plan[], graph: GraphData, manifest?: ProjectManifest) {
  const ctx = {
    projectDir: '/tmp/test',
    config: testConfig,
    plansDir: '/tmp/test/plans',
    plans,
    graph,
    manifest,
  };
  MockCreateCachedContext.mockReturnValue({
    ctx,
    persist: async () => {},
  });
  MockCreateContext.mockReturnValue(ctx);
}

describe('--project --json command-layer tests', () => {
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logs.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      errors.push(args.join(' '));
    });
    MockCreateCachedContext.mockReset();
    MockCreateContext.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  // Shared fixtures
  const local = [
    makePlan('auth', { depends_on: ['canopy:ui-lib'], tags: ['epic:v1'] }),
    makePlan('api', { status: 'not_started', tags: ['epic:v1'] }),
  ];
  const remote = [
    makePlan('ui-lib', { repoAlias: 'canopy', status: 'done', tags: ['epic:v1'] }),
    makePlan('core', { repoAlias: 'canopy', status: 'not_started', tags: ['epic:v2'] }),
  ];
  const merged = mergeWithRemote(local, remote);
  const graph = buildGraph(merged);

  // =============================================
  // status --project --json
  // =============================================

  describe('status --project --json', () => {
    it('includes repos array and repoAlias on plans', async () => {
      setupContext(merged, graph, testManifest);
      await statusCommand({ json: true, project: true, all: true });

      const output = JSON.parse(logs[0]);
      expect(output).toHaveProperty('repos');
      expect(Array.isArray(output.repos)).toBe(true);
      expect(output.repos.length).toBe(2);

      // Local repo first
      expect(output.repos[0].alias).toBe('myproject');
      expect(output.repos[0].local).toBe(true);
      expect(output.repos[1].alias).toBe('canopy');
      expect(output.repos[1].local).toBe(false);

      // Plans have repoAlias
      const remotePlan = output.plans.find((p: any) => p.id === 'canopy:ui-lib');
      expect(remotePlan).toBeDefined();
      expect(remotePlan.repoAlias).toBe('canopy');

      const localPlan = output.plans.find((p: any) => p.id === 'api');
      expect(localPlan).toBeDefined();
      expect(localPlan.repoAlias).toBeNull();
    });

    it('omits repos array without --project', async () => {
      setupContext(merged, graph, testManifest);
      await statusCommand({ json: true });

      const output = JSON.parse(logs[0]);
      expect(output).not.toHaveProperty('repos');
    });
  });

  // =============================================
  // ready --project --json
  // =============================================

  describe('ready --project --json', () => {
    it('includes repos array and repoAlias on plans', async () => {
      setupContext(merged, graph, testManifest);
      await readyCommand({ json: true, project: true });

      const output = JSON.parse(logs[0]);
      expect(output).toHaveProperty('repos');
      expect(output).toHaveProperty('plans');
      expect(output).toHaveProperty('next');

      // Plans have repoAlias
      const remotePlan = output.plans.find((p: any) => p.id === 'canopy:core');
      expect(remotePlan).toBeDefined();
      expect(remotePlan.repoAlias).toBe('canopy');

      const localPlan = output.plans.find((p: any) => p.id === 'api');
      expect(localPlan).toBeDefined();
      expect(localPlan.repoAlias).toBeNull();
    });

    it('outputs bare array without --project (backwards compat)', async () => {
      setupContext(merged, graph, testManifest);
      await readyCommand({ json: true });

      const output = JSON.parse(logs[0]);
      expect(Array.isArray(output)).toBe(true);
    });
  });

  // =============================================
  // graph --project --json
  // =============================================

  describe('graph --project --json', () => {
    it('includes repos array and repoAlias on nodes', async () => {
      setupContext(merged, graph, testManifest);
      await graphCommand({ json: true, project: true });

      const output = JSON.parse(logs[0]);
      expect(output).toHaveProperty('repos');
      expect(output).toHaveProperty('nodes');
      expect(output).toHaveProperty('edges');

      const remoteNode = output.nodes.find((n: any) => n.id === 'canopy:ui-lib');
      expect(remoteNode).toBeDefined();
      expect(remoteNode.repoAlias).toBe('canopy');

      const localNode = output.nodes.find((n: any) => n.id === 'auth');
      expect(localNode).toBeDefined();
      expect(localNode.repoAlias).toBeNull();
    });

    it('omits repos array without --project', async () => {
      setupContext(merged, graph, testManifest);
      await graphCommand({ json: true });

      const output = JSON.parse(logs[0]);
      expect(output).not.toHaveProperty('repos');
    });
  });

  // =============================================
  // lint --project --json
  // =============================================

  describe('lint --project --json', () => {
    it('includes repos array and repoAlias on issues', async () => {
      // Create plans with lint errors: missing dep
      const lintLocal = [
        makePlan('broken', { depends_on: ['nonexistent'] }),
      ];
      const lintRemote = [
        makePlan('remote-broken', { repoAlias: 'canopy', depends_on: ['canopy:missing'] }),
      ];
      const lintMerged = mergeWithRemote(lintLocal, lintRemote);
      const lintGraph = buildGraph(lintMerged);

      setupContext(lintMerged, lintGraph, testManifest);
      await lintCommand({ json: true, project: true });

      const output = JSON.parse(logs[0]);
      expect(output).toHaveProperty('repos');
      expect(output).toHaveProperty('errors');
      expect(output).toHaveProperty('warnings');

      // Errors have repoAlias
      const localError = output.errors.find((e: any) => e.plan_id === 'broken');
      if (localError) {
        expect(localError.repoAlias).toBeNull();
      }

      const remoteError = output.errors.find((e: any) => e.plan_id === 'canopy:remote-broken');
      if (remoteError) {
        expect(remoteError.repoAlias).toBe('canopy');
      }
    });

    it('omits repos and repoAlias without --project', async () => {
      const lintLocal = [makePlan('broken', { depends_on: ['nonexistent'] })];
      const lintGraph = buildGraph(lintLocal);
      setupContext(lintLocal, lintGraph);
      await lintCommand({ json: true });

      const output = JSON.parse(logs[0]);
      expect(output).not.toHaveProperty('repos');

      // Errors should not have repoAlias field
      if (output.errors.length > 0) {
        expect(output.errors[0]).not.toHaveProperty('repoAlias');
      }
    });
  });

  // =============================================
  // epic --project --json (single epic)
  // =============================================

  describe('epic --project --json', () => {
    it('includes repos array on named epic', () => {
      setupContext(merged, graph, testManifest);
      epicCommand({ json: true, project: true }, 'v1');

      const output = JSON.parse(logs[0]);
      expect(output).toHaveProperty('repos');
      expect(output).toHaveProperty('plans');

      const remotePlan = output.plans.find((p: any) => p.id === 'canopy:ui-lib');
      expect(remotePlan).toBeDefined();
      expect(remotePlan.repoAlias).toBe('canopy');
    });
  });

  // =============================================
  // chunks --project --json
  // =============================================

  describe('chunks --project --json', () => {
    it('wraps output in repos array with per-repo chunks', () => {
      setupContext(merged, graph, testManifest);
      chunksCommand({ json: true, project: true });

      const output = JSON.parse(logs[0]);
      expect(output).toHaveProperty('repos');
      expect(Array.isArray(output.repos)).toBe(true);

      // Should have entries for repos with plans
      const localRepo = output.repos.find((r: any) => r.alias === 'myproject');
      expect(localRepo).toBeDefined();
      expect(localRepo.local).toBe(true);
      expect(localRepo).toHaveProperty('chunks');

      const remoteRepo = output.repos.find((r: any) => r.alias === 'canopy');
      expect(remoteRepo).toBeDefined();
      expect(remoteRepo.local).toBe(false);
    });

    it('returns flat ChunkResult without --project', () => {
      const localOnly = merged.filter(p => p.repoAlias == null);
      const localGraph = buildGraph(localOnly);
      setupContext(localOnly, localGraph);
      chunksCommand({ json: true });

      const output = JSON.parse(logs[0]);
      expect(output).not.toHaveProperty('repos');
      expect(output).toHaveProperty('chunks');
    });
  });

  // =============================================
  // No manifest + --project
  // =============================================

  describe('no manifest + --project', () => {
    it('warns to stderr and shows local-only', async () => {
      setupContext(merged, graph); // no manifest
      await statusCommand({ json: true, project: true });

      expect(errors).toContain('No manifest configured — showing local plans only');
      const output = JSON.parse(logs[0]);
      // Should not have repos array since isProject is false
      expect(output).not.toHaveProperty('repos');
      // Should only have local plans
      const planIds = output.plans.map((p: any) => p.id);
      expect(planIds).not.toContain('canopy:ui-lib');
    });
  });
});

// =============================================
// buildReposArray unit tests
// =============================================

describe('buildReposArray', () => {
  it('groups items and sorts local first', () => {
    const items = [
      { repoAlias: undefined },
      { repoAlias: undefined },
      { repoAlias: 'canopy' },
      { repoAlias: 'zebra' },
    ];
    const result = buildReposArray(items, 'myproject');
    expect(result).toEqual([
      { alias: 'myproject', local: true, plan_count: 2 },
      { alias: 'canopy', local: false, plan_count: 1 },
      { alias: 'zebra', local: false, plan_count: 1 },
    ]);
  });

  it('handles empty input', () => {
    expect(buildReposArray([], 'myproject')).toEqual([]);
  });
});
