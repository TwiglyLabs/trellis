import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mergeWithRemote,
  buildGraph,
  toSummary,
  resolveIsProject,
  buildReposArray,
} from '../core/index.ts';
import type { Plan, ProjectManifest, PlanSummary, TrellisContext } from '../core/types.ts';
import type { GraphData } from '../core/graph.ts';
import { computeStatus } from '../features/status/logic.ts';
import { computeReady } from '../features/ready/logic.ts';
import { computeGraph } from '../features/graph/logic.ts';
import { computeEpic } from '../features/epic/logic.ts';
import { computeChunksFeature } from '../features/chunks/logic.ts';

// Command imports for command-layer tests
import { statusCommand } from '../features/status/command.ts';
import { readyCommand } from '../features/ready/command.ts';
import { graphCommand } from '../features/graph/command.ts';
import { lintCommand } from '../features/lint/command.ts';
import { epicCommand } from '../features/epic/command.ts';
import { chunksCommand } from '../features/chunks/command.ts';

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
    trellis: { url: 'x', branch: 'main', visibility: 'public' },
    canopy: { url: 'y', branch: 'main', visibility: 'public' },
  },
};

// =============================================
// toSummary: repoAlias propagation
// =============================================

describe('toSummary propagates repoAlias', () => {
  it('includes repoAlias for remote plans', () => {
    const plan = makePlan('ui-lib', { repoAlias: 'canopy' });
    const summary = toSummary(plan);
    expect(summary.repoAlias).toBe('canopy');
  });

  it('repoAlias is undefined for local plans', () => {
    const plan = makePlan('auth');
    const summary = toSummary(plan);
    expect(summary.repoAlias).toBeUndefined();
  });
});

// =============================================
// resolveIsProject
// =============================================

describe('resolveIsProject', () => {
  it('returns true when isProjectMode is true', () => {
    expect(resolveIsProject({ isProjectMode: true, manifest: testManifest })).toBe(true);
  });

  it('returns true when isProjectMode is true even without manifest', () => {
    expect(resolveIsProject({ isProjectMode: true })).toBe(true);
  });

  it('returns false when isProjectMode is false and no flag', () => {
    expect(resolveIsProject({ isProjectMode: false, manifest: testManifest })).toBe(false);
  });

  it('returns true when --project flag passed with manifest', () => {
    expect(resolveIsProject({ isProjectMode: false, manifest: testManifest }, true)).toBe(true);
  });

  it('warns and returns false when --project flag passed without manifest', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveIsProject({ isProjectMode: false }, true)).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith('No manifest configured — showing local plans only');
    errorSpy.mockRestore();
  });

  it('returns false when no flag and not in project mode', () => {
    expect(resolveIsProject({ isProjectMode: false })).toBe(false);
  });
});

// =============================================
// computeStatus with --project
// =============================================

describe('computeStatus with project flag', () => {
  const local = [
    makePlan('auth', { depends_on: ['canopy:ui-lib'] }),
    makePlan('api', { status: 'in_progress' }),
  ];
  const remote = [
    makePlan('ui-lib', { repoAlias: 'canopy', status: 'in_progress' }),
    makePlan('core', { repoAlias: 'canopy', status: 'done' }),
  ];
  const merged = mergeWithRemote(local, remote);
  const graph = buildGraph(merged);

  it('includes remote plans when project=true', () => {
    const result = computeStatus({
      plans: merged,
      config: { project: 'test', plans_dir: 'plans' },
      graph,
      filters: { project: true, showDone: true },
    });

    const allIds = [
      ...result.byStatus.ready,
      ...result.byStatus.blocked,
      ...result.byStatus.inProgress,
      ...result.byStatus.draft,
      ...result.byStatus.done,
    ].map(p => p.id);

    expect(allIds).toContain('canopy:ui-lib');
    expect(allIds).toContain('canopy:core');
    expect(allIds).toContain('auth');
    expect(allIds).toContain('api');
  });

  it('excludes remote plans when project is not set', () => {
    const result = computeStatus({
      plans: merged,
      config: { project: 'test', plans_dir: 'plans' },
      graph,
    });

    const allIds = [
      ...result.byStatus.ready,
      ...result.byStatus.blocked,
      ...result.byStatus.inProgress,
      ...result.byStatus.draft,
      ...result.byStatus.done,
    ].map(p => p.id);

    expect(allIds).not.toContain('canopy:ui-lib');
    expect(allIds).toContain('auth');
  });

  it('plan summaries include repoAlias', () => {
    const result = computeStatus({
      plans: merged,
      config: { project: 'test', plans_dir: 'plans' },
      graph,
      filters: { project: true },
    });

    const remotePlan = result.byStatus.inProgress.find(p => p.id === 'canopy:ui-lib');
    expect(remotePlan).toBeDefined();
    expect(remotePlan!.repoAlias).toBe('canopy');

    const localPlan = result.byStatus.inProgress.find(p => p.id === 'api');
    expect(localPlan).toBeDefined();
    expect(localPlan!.repoAlias).toBeUndefined();
  });
});

// =============================================
// computeReady with --project
// =============================================

describe('computeReady with project flag', () => {
  const local = [
    makePlan('a', { depends_on: ['canopy:blocker'] }),
    makePlan('b'),
  ];
  const remote = [
    makePlan('blocker', { repoAlias: 'canopy', status: 'in_progress' }),
    makePlan('ready-remote', { repoAlias: 'canopy' }),
  ];
  const merged = mergeWithRemote(local, remote);
  const graph = buildGraph(merged);

  it('includes remote ready plans when project=true', () => {
    const result = computeReady({
      plans: merged,
      graph,
      filters: { project: true },
    });

    const readyIds = result.plans.map(p => p.id);
    expect(readyIds).toContain('b');
    expect(readyIds).toContain('canopy:ready-remote');
    expect(readyIds).not.toContain('a'); // blocked
  });

  it('excludes remote plans when project is not set', () => {
    const result = computeReady({
      plans: merged,
      graph,
    });

    const readyIds = result.plans.map(p => p.id);
    expect(readyIds).toEqual(['b']);
  });

  it('--next picks from local plans only even with project=true', () => {
    const result = computeReady({
      plans: merged,
      graph,
      filters: { project: true },
    });

    // next should be 'b' (local), not canopy:ready-remote
    expect(result.next).toBe('b');
  });

  it('ready plan summaries include repoAlias', () => {
    const result = computeReady({
      plans: merged,
      graph,
      filters: { project: true },
    });

    const remotePlan = result.plans.find(p => p.id === 'canopy:ready-remote');
    expect(remotePlan).toBeDefined();
    expect(remotePlan!.repoAlias).toBe('canopy');
  });
});

// =============================================
// computeGraph with --project
// =============================================

describe('computeGraph with project flag', () => {
  const local = [makePlan('auth', { depends_on: ['canopy:ui-lib'] })];
  const remote = [makePlan('ui-lib', { repoAlias: 'canopy', status: 'done' })];
  const merged = mergeWithRemote(local, remote);
  const graph = buildGraph(merged);
  const config = { project: 'test', plans_dir: 'plans' };

  it('includes remote nodes when all plans passed', () => {
    const result = computeGraph({ plans: merged, graph, config });
    const nodeIds = result.nodes.map(n => n.id);
    expect(nodeIds).toContain('canopy:ui-lib');
    expect(nodeIds).toContain('auth');
  });

  it('nodes carry repoAlias', () => {
    const result = computeGraph({ plans: merged, graph, config });
    const remoteNode = result.nodes.find(n => n.id === 'canopy:ui-lib');
    expect(remoteNode).toBeDefined();
    expect(remoteNode!.repoAlias).toBe('canopy');

    const localNode = result.nodes.find(n => n.id === 'auth');
    expect(localNode!.repoAlias).toBeUndefined();
  });

  it('local-only when filtered plans', () => {
    const localOnly = merged.filter(p => p.repoAlias == null);
    const result = computeGraph({ plans: localOnly, graph, config });
    const nodeIds = result.nodes.map(n => n.id);
    expect(nodeIds).toEqual(['auth']);
  });
});

// =============================================
// computeEpic with --project
// =============================================

describe('computeEpic with project flag', () => {
  const local = [
    makePlan('auth', { tags: ['epic:v1'], status: 'done' }),
    makePlan('api', { tags: ['epic:v1'], status: 'in_progress' }),
  ];
  const remote = [
    makePlan('ui-lib', { repoAlias: 'canopy', tags: ['epic:v1'] }),
    makePlan('core', { repoAlias: 'canopy', tags: ['epic:v2'], status: 'done' }),
  ];
  const merged = mergeWithRemote(local, remote);
  const graph = buildGraph(merged);

  it('spans repos when all plans passed', () => {
    const epics = computeEpic({ plans: merged, graph });
    const v1 = epics.find(e => e.epic === 'v1');
    expect(v1).toBeDefined();
    expect(v1!.total).toBe(3); // auth + api + canopy:ui-lib
    expect(v1!.done).toBe(1); // auth
  });

  it('local-only when filtered', () => {
    const localOnly = merged.filter(p => p.repoAlias == null);
    const epics = computeEpic({ plans: localOnly, graph });
    const v1 = epics.find(e => e.epic === 'v1');
    expect(v1).toBeDefined();
    expect(v1!.total).toBe(2); // auth + api only
  });

  it('includes plans from multiple repos in named epic', () => {
    const epics = computeEpic({ plans: merged, graph, name: 'v1' });
    expect(epics).toHaveLength(1);
    const planIds = epics[0].plans!.map(p => p.id);
    expect(planIds).toContain('auth');
    expect(planIds).toContain('api');
    expect(planIds).toContain('canopy:ui-lib');
  });

  it('plan summaries in epics carry repoAlias', () => {
    const epics = computeEpic({ plans: merged, graph, name: 'v1' });
    const remotePlan = epics[0].plans!.find(p => p.id === 'canopy:ui-lib');
    expect(remotePlan!.repoAlias).toBe('canopy');
  });
});

// =============================================
// computeChunksFeature per-repo
// =============================================

describe('computeChunksFeature with project mode', () => {
  it('local plans chunk independently from remote', () => {
    const local = [
      makePlan('a', { lineCount: 100 }),
      makePlan('b', { lineCount: 100, depends_on: ['a'] }),
    ];
    const remote = [
      makePlan('x', { repoAlias: 'canopy', lineCount: 100 }),
    ];
    const merged = mergeWithRemote(local, remote);

    // Local-only chunks
    const localGraph = buildGraph(local);
    const localResult = computeChunksFeature({
      plans: local,
      graph: localGraph,
      config: { project: 'test', plans_dir: 'plans' },
    });

    // Remote-only chunks
    const remoteOnly = merged.filter(p => p.repoAlias === 'canopy');
    const remoteGraph = buildGraph(remoteOnly);
    const remoteResult = computeChunksFeature({
      plans: remoteOnly,
      graph: remoteGraph,
      config: { project: 'test', plans_dir: 'plans' },
    });

    // Local plans should not include remote plans
    const localPlanIds = localResult.chunks.flatMap(c => c.plans.map(p => p.id));
    expect(localPlanIds).not.toContain('canopy:x');

    // Remote should have its own chunks
    const remotePlanIds = remoteResult.chunks.flatMap(c => c.plans.map(p => p.id));
    expect(remotePlanIds).toContain('canopy:x');
  });
});

// =============================================
// Backwards compatibility
// =============================================

describe('backwards compatibility (no --project)', () => {
  const local = [makePlan('auth')];
  const remote = [makePlan('ui-lib', { repoAlias: 'canopy' })];
  const merged = mergeWithRemote(local, remote);
  const graph = buildGraph(merged);

  it('computeStatus excludes remote plans by default', () => {
    const result = computeStatus({
      plans: merged,
      config: { project: 'test', plans_dir: 'plans' },
      graph,
    });

    const allIds = [
      ...result.byStatus.ready,
      ...result.byStatus.blocked,
      ...result.byStatus.inProgress,
      ...result.byStatus.draft,
    ].map(p => p.id);

    expect(allIds).toEqual(['auth']);
  });

  it('computeReady excludes remote plans by default', () => {
    const result = computeReady({ plans: merged, graph });
    expect(result.plans.map(p => p.id)).toEqual(['auth']);
  });
});
