import { describe, it, expect } from 'vitest';
import { formatStatus, formatShow, formatGraph, formatLint, formatBottlenecks } from '../core/format.ts';
import type { StatusResult } from '../features/status/logic.ts';
import type { ReadyResult } from '../features/ready/logic.ts';
import type { ShowResult } from '../features/show/logic.ts';
import type { GraphResult } from '../features/graph/logic.ts';
import type { LintResult } from '../features/lint/logic.ts';
import type { BottleneckResult } from '../core/types.ts';

describe('formatStatus', () => {
  function makeStatus(overrides: Partial<StatusResult> = {}): StatusResult {
    return {
      project: 'my-project',
      total: 0,
      chunks: { total: 0, overBudget: 0 },
      byStatus: {
        ready: [],
        blocked: [],
        inProgress: [],
        draft: [],
        done: [],
        archived: [],
      },
      ...overrides,
    };
  }

  function makeReady(overrides: Partial<ReadyResult> = {}): ReadyResult {
    return { plans: [], next: null, ...overrides };
  }

  it('renders header with plan count', () => {
    const text = formatStatus(makeStatus({ total: 5 }), makeReady());
    expect(text).toContain('# my-project (5 plans)');
  });

  it('renders tag filter in header', () => {
    const text = formatStatus(makeStatus({ total: 2 }), makeReady(), 'epic:auth');
    expect(text).toContain('(tag: epic:auth)');
  });

  it('renders Next recommendation', () => {
    const text = formatStatus(makeStatus(), makeReady({ next: 'plan-a' }));
    expect(text).toContain('Next: plan-a');
  });

  it('omits Next when null', () => {
    const text = formatStatus(makeStatus(), makeReady({ next: null }));
    expect(text).not.toContain('Next:');
  });

  it('renders overBudget warning', () => {
    const text = formatStatus(makeStatus({ chunks: { total: 5, overBudget: 2 } }), makeReady());
    expect(text).toContain('⚠ 2 chunks over budget');
  });

  it('omits overBudget when zero', () => {
    const text = formatStatus(makeStatus({ chunks: { total: 5, overBudget: 0 } }), makeReady());
    expect(text).not.toContain('over budget');
  });

  it('renders all sections in order', () => {
    const status = makeStatus({
      total: 6,
      byStatus: {
        inProgress: [{ id: 'ip', title: 'In Progress Plan', status: 'in_progress', tags: [] }],
        ready: [{ id: 'r', title: 'Ready Plan', status: 'not_started', tags: [] }],
        blocked: [{ id: 'bl', title: 'Blocked Plan', status: 'not_started', tags: [], waitingOn: ['ip'] }],
        draft: [{ id: 'd', title: 'Draft Plan', status: 'draft', tags: [] }],
        done: [{ id: 'dn', title: 'Done Plan', status: 'done', tags: [] }],
        archived: [{ id: 'ar', title: 'Archived Plan', status: 'archived', tags: [] }],
      },
    });
    const text = formatStatus(status, makeReady());

    // Check section order
    const ipIdx = text.indexOf('## In Progress');
    const rIdx = text.indexOf('## Ready');
    const blIdx = text.indexOf('## Blocked');
    const dIdx = text.indexOf('## Draft');
    const dnIdx = text.indexOf('## Done');
    expect(ipIdx).toBeLessThan(rIdx);
    expect(rIdx).toBeLessThan(blIdx);
    expect(blIdx).toBeLessThan(dIdx);
    expect(dIdx).toBeLessThan(dnIdx);

    // Archived omitted
    expect(text).not.toContain('Archived');
  });

  it('omits empty sections', () => {
    const text = formatStatus(makeStatus({ total: 1, byStatus: { ready: [{ id: 'a', title: 'A', status: 'not_started', tags: [] }], blocked: [], inProgress: [], draft: [], done: [], archived: [] } }), makeReady());
    expect(text).toContain('## Ready (1)');
    expect(text).not.toContain('## In Progress');
    expect(text).not.toContain('## Blocked');
    expect(text).not.toContain('## Draft');
    expect(text).not.toContain('## Done');
  });

  it('renders plan line with assignee', () => {
    const status = makeStatus({
      total: 1,
      byStatus: { ready: [], blocked: [], inProgress: [{ id: 'a', title: 'A Plan', status: 'in_progress', tags: [], assignee: 'alice' }], draft: [], done: [], archived: [] },
    });
    const text = formatStatus(status, makeReady());
    expect(text).toContain('- a: A Plan [alice]');
  });

  it('renders blocked plan with waiting on', () => {
    const status = makeStatus({
      total: 1,
      byStatus: { ready: [], blocked: [{ id: 'bl', title: 'Blocked', status: 'not_started', tags: [], waitingOn: ['x', 'y'] }], inProgress: [], draft: [], done: [], archived: [] },
    });
    const text = formatStatus(status, makeReady());
    expect(text).toContain('- bl: Blocked (waiting on: x, y)');
  });

  it('renders done as comma-separated IDs', () => {
    const status = makeStatus({
      total: 3,
      byStatus: {
        ready: [], blocked: [], inProgress: [], draft: [], archived: [],
        done: [
          { id: 'a', title: 'A', status: 'done', tags: [] },
          { id: 'b', title: 'B', status: 'done', tags: [] },
          { id: 'c', title: 'C', status: 'done', tags: [] },
        ],
      },
    });
    const text = formatStatus(status, makeReady());
    expect(text).toContain('## Done (3)');
    expect(text).toContain('a, b, c');
  });

  it('handles all-done plan set', () => {
    const status = makeStatus({
      total: 2,
      byStatus: {
        ready: [], blocked: [], inProgress: [], draft: [], archived: [],
        done: [
          { id: 'x', title: 'X', status: 'done', tags: [] },
          { id: 'y', title: 'Y', status: 'done', tags: [] },
        ],
      },
    });
    const text = formatStatus(status, makeReady());
    expect(text).toContain('(2 plans)');
    expect(text).toContain('## Done (2)');
    expect(text).not.toContain('## Ready');
  });

  it('handles empty plan set', () => {
    const text = formatStatus(makeStatus(), makeReady());
    expect(text).toContain('(0 plans)');
    expect(text).not.toContain('##');
  });
});

describe('formatShow', () => {
  function makeShow(overrides: Partial<ShowResult> = {}): ShowResult {
    return {
      id: 'plan-a',
      filePath: '/plans/plan-a/README.md',
      title: 'Plan A',
      status: 'not_started',
      blocked: false,
      ready: true,
      tags: [],
      body: '',
      dependsOn: [],
      blocks: [],
      criticalPath: ['plan-a'],
      updatedAt: '2026-02-20T00:00:00Z',
      fileHashes: {},
      completeness: null,
      inputs: null,
      outputs: null,
      ...overrides,
    };
  }

  it('renders header with title and id', () => {
    const text = formatShow(makeShow());
    expect(text).toContain('# Plan A (plan-a)');
  });

  it('renders status with ready annotation', () => {
    const text = formatShow(makeShow({ ready: true, blocked: false }));
    expect(text).toContain('Status: not_started (ready)');
  });

  it('renders status with blocked annotation', () => {
    const text = formatShow(makeShow({ ready: false, blocked: true }));
    expect(text).toContain('Status: not_started (blocked)');
  });

  it('renders plain status when neither ready nor blocked', () => {
    const text = formatShow(makeShow({ ready: false, blocked: false, status: 'in_progress' }));
    expect(text).toContain('Status: in_progress');
    expect(text).not.toContain('(ready)');
    expect(text).not.toContain('(blocked)');
  });

  it('renders optional metadata fields', () => {
    const text = formatShow(makeShow({
      type: 'feature',
      tags: ['auth', 'security'],
      assignee: 'alice',
      repo: 'public',
    }));
    expect(text).toContain('Type: feature');
    expect(text).toContain('Tags: auth, security');
    expect(text).toContain('Assignee: alice');
    expect(text).toContain('Repo: public');
  });

  it('omits metadata fields when absent', () => {
    const text = formatShow(makeShow());
    expect(text).not.toContain('Type:');
    expect(text).not.toContain('Tags:');
    expect(text).not.toContain('Assignee:');
    expect(text).not.toContain('Repo:');
  });

  it('renders description', () => {
    const text = formatShow(makeShow({ description: 'Add JWT auth' }));
    expect(text).toContain('Add JWT auth');
  });

  it('renders dependencies with satisfied/unsatisfied markers', () => {
    const text = formatShow(makeShow({
      dependsOn: [
        { id: 'dep-a', status: 'done', satisfied: true },
        { id: 'dep-b', status: 'in_progress', satisfied: false },
      ],
    }));
    expect(text).toContain('## Dependencies');
    expect(text).toContain('✓ dep-a (done)');
    expect(text).toContain('○ dep-b (in_progress)');
  });

  it('omits dependencies section when empty', () => {
    const text = formatShow(makeShow({ dependsOn: [] }));
    expect(text).not.toContain('## Dependencies');
  });

  it('renders blocks', () => {
    const text = formatShow(makeShow({ blocks: ['plan-x', 'plan-y'] }));
    expect(text).toContain('## Blocks');
    expect(text).toContain('plan-x, plan-y');
  });

  it('omits blocks when empty', () => {
    const text = formatShow(makeShow({ blocks: [] }));
    expect(text).not.toContain('## Blocks');
  });

  it('renders critical path with arrows', () => {
    const text = formatShow(makeShow({ criticalPath: ['a', 'b', 'c'] }));
    expect(text).toContain('## Critical Path');
    expect(text).toContain('a → b → c');
  });

  it('omits critical path when single node', () => {
    const text = formatShow(makeShow({ criticalPath: ['plan-a'] }));
    expect(text).not.toContain('## Critical Path');
  });

  it('ignores body, fileHashes, completeness, inputs, outputs', () => {
    const text = formatShow(makeShow({
      body: 'Some long markdown body',
      fileHashes: { 'README.md': 'abc123' },
      completeness: { sections: {}, aggregate: 100 },
      inputs: [{ heading: 'Inputs', items: ['foo'] }],
      outputs: [{ heading: 'Outputs', items: ['bar'] }],
    }));
    expect(text).not.toContain('Some long markdown body');
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('aggregate');
  });
});

describe('formatGraph', () => {
  function makeGraph(overrides: Partial<GraphResult> = {}): GraphResult {
    return {
      project: 'my-project',
      nodes: [],
      edges: [],
      chunks: [],
      crossChunkEdges: [],
      ...overrides,
    };
  }

  it('renders header with project name', () => {
    const text = formatGraph(makeGraph());
    expect(text).toContain('# my-project dependency graph');
  });

  it('renders edges', () => {
    const text = formatGraph(makeGraph({
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ],
    }));
    expect(text).toContain('## Edges');
    expect(text).toContain('a → b');
    expect(text).toContain('a → c');
  });

  it('omits edges section when empty', () => {
    const text = formatGraph(makeGraph({ edges: [] }));
    expect(text).not.toContain('## Edges');
  });

  it('renders chunks', () => {
    const text = formatGraph(makeGraph({
      chunks: [{
        id: 'chunk-1',
        plans: [
          { id: 'a', filePath: '/a', lines: 100 },
          { id: 'b', filePath: '/b', lines: 200 },
        ],
        roots: ['a'],
        leaves: ['b'],
        planCount: 2,
        totalLines: 300,
        internalEdges: [{ from: 'a', to: 'b' }],
      }],
    }));
    expect(text).toContain('## Chunks');
    expect(text).toContain('### chunk-1 (2 plans, 300 lines)');
    expect(text).toContain('Plans: a, b');
    expect(text).toContain('Roots: a | Leaves: b');
  });

  it('renders cross-chunk edges', () => {
    const text = formatGraph(makeGraph({
      crossChunkEdges: [{
        from: 'c', to: 'd',
        fromChunk: 'chunk-2', toChunk: 'chunk-1',
      }],
    }));
    expect(text).toContain('## Cross-chunk Edges');
    expect(text).toContain('c (chunk-2) → d (chunk-1)');
  });

  it('omits cross-chunk edges when empty', () => {
    const text = formatGraph(makeGraph({ crossChunkEdges: [] }));
    expect(text).not.toContain('## Cross-chunk Edges');
  });

  it('does not include nodes array', () => {
    const text = formatGraph(makeGraph({
      nodes: [{ id: 'a', title: 'A', status: 'draft', blocked: false, ready: false, dependsOn: [], tags: [] }],
    }));
    // Nodes should not appear in text output
    expect(text).not.toContain('nodes');
    // But id might appear in edges/chunks — just ensure no structured node data
    expect(text).not.toContain('"id"');
  });
});

describe('formatLint', () => {
  function makeLint(overrides: Partial<LintResult> = {}): LintResult {
    return {
      ok: true,
      total: 0,
      okCount: 0,
      errors: [],
      warnings: [],
      structural: { errors: [], warnings: [] },
      fixed: [],
      ...overrides,
    };
  }

  it('renders header with counts', () => {
    const text = formatLint(makeLint({
      errors: [{ planId: 'a', type: 'missing_dep', message: 'Missing dep' }],
      warnings: [{ planId: 'b', type: 'orphan', message: 'Orphan' }],
    }));
    expect(text).toContain('# Lint (1 errors, 1 warnings)');
  });

  it('merges structural issues into main sections', () => {
    const text = formatLint(makeLint({
      errors: [{ planId: 'a', type: 'err', message: 'Error A' }],
      structural: {
        errors: [{ planId: 'b', type: 'struct_err', message: 'Structural error' }],
        warnings: [{ planId: 'c', type: 'struct_warn', message: 'Structural warning' }],
      },
    }));
    expect(text).toContain('# Lint (2 errors, 1 warnings)');
    expect(text).toContain('- a: Error A');
    expect(text).toContain('- b: Structural error');
    expect(text).toContain('- c: Structural warning');
  });

  it('renders ok: true when no errors', () => {
    const text = formatLint(makeLint({ ok: true }));
    expect(text).toContain('ok: true');
  });

  it('renders ok: false when errors present', () => {
    const text = formatLint(makeLint({ ok: false }));
    expect(text).toContain('ok: false');
  });

  it('omits errors section when empty', () => {
    const text = formatLint(makeLint({ errors: [], structural: { errors: [], warnings: [] } }));
    expect(text).not.toContain('## Errors');
  });

  it('omits warnings section when empty', () => {
    const text = formatLint(makeLint({ warnings: [], structural: { errors: [], warnings: [] } }));
    expect(text).not.toContain('## Warnings');
  });

  it('renders auto-fixed', () => {
    const text = formatLint(makeLint({ fixed: ['plan-a', 'plan-b'] }));
    expect(text).toContain('## Auto-fixed');
    expect(text).toContain('- plan-a');
    expect(text).toContain('- plan-b');
  });

  it('omits auto-fixed when empty', () => {
    const text = formatLint(makeLint({ fixed: [] }));
    expect(text).not.toContain('## Auto-fixed');
  });
});

describe('formatBottlenecks', () => {
  function makeBottlenecks(overrides: Partial<BottleneckResult> = {}): BottleneckResult {
    return {
      highBlockingPlans: [],
      stuckPlans: [],
      stalePlans: [],
      layerPressure: [],
      healthSummary: {
        totalPlans: 0,
        activePlans: 0,
        blockedPlans: 0,
        stuckPlans: 0,
        highBlockingPlans: 0,
        estimatedParallelism: 0,
      },
      ...overrides,
    };
  }

  it('renders header', () => {
    const text = formatBottlenecks(makeBottlenecks());
    expect(text).toContain('# Bottlenecks');
  });

  it('renders high blocking plans', () => {
    const text = formatBottlenecks(makeBottlenecks({
      highBlockingPlans: [
        { id: 'api', title: 'API', status: 'in_progress', blockingFactor: 8 },
      ],
    }));
    expect(text).toContain('## High Blocking');
    expect(text).toContain('- api: blocks 8 transitively (in_progress)');
  });

  it('renders stuck plans', () => {
    const text = formatBottlenecks(makeBottlenecks({
      stuckPlans: [
        { id: 'auth', title: 'Auth', daysInStatus: 14 },
      ],
    }));
    expect(text).toContain('## Stuck');
    expect(text).toContain('- auth: 14 days in status');
  });

  it('renders stale plans', () => {
    const text = formatBottlenecks(makeBottlenecks({
      stalePlans: [
        { id: 'v1', title: 'V1 Compat', status: 'draft', daysInStatus: 30 },
      ],
    }));
    expect(text).toContain('## Stale');
    expect(text).toContain('- v1: 30 days in draft');
  });

  it('omits empty sections', () => {
    const text = formatBottlenecks(makeBottlenecks());
    expect(text).not.toContain('## High Blocking');
    expect(text).not.toContain('## Stuck');
    expect(text).not.toContain('## Stale');
  });

  it('always renders health summary', () => {
    const text = formatBottlenecks(makeBottlenecks({
      healthSummary: {
        totalPlans: 15,
        activePlans: 8,
        blockedPlans: 3,
        stuckPlans: 2,
        highBlockingPlans: 1,
        estimatedParallelism: 3,
      },
    }));
    expect(text).toContain('## Health');
    expect(text).toContain('15 total, 8 active, 3 blocked, 2 stuck, parallelism: 3');
  });

  it('does not include layer pressure', () => {
    const text = formatBottlenecks(makeBottlenecks({
      layerPressure: [{ depth: 0, blocked: 1, inProgress: 2, ratio: 0.5 }],
    }));
    expect(text).not.toContain('depth');
    expect(text).not.toContain('ratio');
    expect(text).not.toContain('Layer');
  });
});
