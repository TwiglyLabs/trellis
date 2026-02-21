import { describe, it, expect } from 'vitest';
import { buildGraph, patchGraph } from './graph.ts';
import type { Plan } from './types.ts';
import type { PlanChangeEvent } from '../features/watch/types.ts';

function makePlan(id: string, status: string, depends_on: string[] = [], opts?: { tags?: string[]; body?: string }): Plan {
  return {
    id,
    filePath: `plans/${id}/README.md`,
    frontmatter: {
      title: id,
      status: status as any,
      depends_on: depends_on.length > 0 ? depends_on : undefined,
      tags: opts?.tags,
    },
    body: opts?.body ?? '',
    lineCount: (opts?.body ?? '').split('\n').length + 4,
    updatedAt: new Date(),
    fileHashes: {},
  };
}

describe('patchGraph', () => {
  describe('empty batch', () => {
    it('returns the same graph reference for empty events', () => {
      const plans = [makePlan('a', 'not_started'), makePlan('b', 'not_started', ['a'])];
      const graph = buildGraph(plans);
      const result = patchGraph(graph, []);
      expect(result).toBe(graph);
    });
  });

  describe('plan-updated', () => {
    it('refreshes node data without changing neighbors', () => {
      const plans = [
        makePlan('a', 'not_started'),
        makePlan('b', 'not_started', ['a']),
        makePlan('c', 'not_started'),
      ];
      const graph = buildGraph(plans);

      const updatedA = makePlan('a', 'not_started');
      updatedA.frontmatter.title = 'Updated A';

      const events: PlanChangeEvent[] = [
        { type: 'plan-updated', planId: 'a', file: 'readme', plan: updatedA },
      ];

      const result = patchGraph(graph, events);
      expect(result).not.toBe(graph);
      expect(result.plans.get('a')!.frontmatter.title).toBe('Updated A');
      // Unaffected node c should be the same reference
      expect(result.plans.get('c')).toBe(graph.plans.get('c'));
    });

    it('recomputes ready/blocked when plan status changes', () => {
      const plans = [
        makePlan('a', 'not_started'),
        makePlan('b', 'not_started', ['a']),
      ];
      const graph = buildGraph(plans);
      expect(graph.blocked.has('b')).toBe(true);
      expect(graph.ready.has('a')).toBe(true);

      const updatedA = makePlan('a', 'done');
      const events: PlanChangeEvent[] = [
        { type: 'plan-updated', planId: 'a', file: 'readme', plan: updatedA },
      ];

      const result = patchGraph(graph, events);
      expect(result.ready.has('a')).toBe(false); // done plans aren't ready
      expect(result.blocked.has('b')).toBe(false);
      expect(result.ready.has('b')).toBe(true);
    });

    it('handles dependency change: removes old edges, adds new edges', () => {
      const plans = [
        makePlan('a', 'done'),
        makePlan('b', 'done'),
        makePlan('c', 'not_started', ['a']),
      ];
      const graph = buildGraph(plans);
      expect(graph.dependencies.get('c')).toEqual(['a']);
      expect(graph.dependents.get('a')).toContain('c');

      // Change c to depend on b instead of a
      const updatedC = makePlan('c', 'not_started', ['b']);
      const events: PlanChangeEvent[] = [
        { type: 'plan-updated', planId: 'c', file: 'readme', plan: updatedC },
      ];

      const result = patchGraph(graph, events);
      expect(result.dependencies.get('c')).toEqual(['b']);
      expect(result.dependents.get('a')).not.toContain('c');
      expect(result.dependents.get('b')).toContain('c');
      expect(result.ready.has('c')).toBe(true); // b is done
    });
  });

  describe('plan-added', () => {
    it('adds a new node with no dependencies', () => {
      const plans = [makePlan('a', 'not_started')];
      const graph = buildGraph(plans);

      const newPlan = makePlan('b', 'not_started');
      const events: PlanChangeEvent[] = [
        { type: 'plan-added', planId: 'b', plan: newPlan },
      ];

      const result = patchGraph(graph, events);
      expect(result.plans.has('b')).toBe(true);
      expect(result.ready.has('b')).toBe(true);
      expect(result.dependents.get('b')).toEqual([]);
      expect(result.dependencies.get('b')).toEqual([]);
    });

    it('unblocks a previously-blocked plan when its missing dep is added', () => {
      // b depends on a, but a doesn't exist yet => b is blocked
      const planB = makePlan('b', 'not_started', ['a']);
      const graphWithoutA = buildGraph([planB]);
      expect(graphWithoutA.blocked.has('b')).toBe(true);

      // Now add a as done
      const planA = makePlan('a', 'done');
      const events: PlanChangeEvent[] = [
        { type: 'plan-added', planId: 'a', plan: planA },
      ];

      const result = patchGraph(graphWithoutA, events);
      expect(result.plans.has('a')).toBe(true);
      expect(result.dependents.get('a')).toContain('b');
      expect(result.dependencies.get('b')).toContain('a');
      expect(result.ready.has('b')).toBe(true);
      expect(result.blocked.has('b')).toBe(false);
    });

    it('adds edges for the new plans dependencies', () => {
      const plans = [makePlan('a', 'done')];
      const graph = buildGraph(plans);

      const newPlan = makePlan('b', 'not_started', ['a']);
      const events: PlanChangeEvent[] = [
        { type: 'plan-added', planId: 'b', plan: newPlan },
      ];

      const result = patchGraph(graph, events);
      expect(result.dependencies.get('b')).toEqual(['a']);
      expect(result.dependents.get('a')).toContain('b');
      expect(result.ready.has('b')).toBe(true);
    });
  });

  describe('plan-removed', () => {
    it('removes the node and all its edges', () => {
      const plans = [
        makePlan('a', 'done'),
        makePlan('b', 'not_started', ['a']),
      ];
      const graph = buildGraph(plans);

      const events: PlanChangeEvent[] = [
        { type: 'plan-removed', planId: 'b' },
      ];

      const result = patchGraph(graph, events);
      expect(result.plans.has('b')).toBe(false);
      expect(result.dependents.get('a')).not.toContain('b');
      expect(result.dependencies.has('b')).toBe(false);
      expect(result.ready.has('b')).toBe(false);
      expect(result.blocked.has('b')).toBe(false);
    });

    it('blocks dependents when their dependency is removed', () => {
      const plans = [
        makePlan('a', 'done'),
        makePlan('b', 'not_started', ['a']),
      ];
      const graph = buildGraph(plans);
      expect(graph.ready.has('b')).toBe(true);

      const events: PlanChangeEvent[] = [
        { type: 'plan-removed', planId: 'a' },
      ];

      const result = patchGraph(graph, events);
      expect(result.plans.has('a')).toBe(false);
      // b still references a in depends_on, but a is gone => blocked
      expect(result.blocked.has('b')).toBe(true);
      expect(result.ready.has('b')).toBe(false);
    });

    it('removes a leaf plan cleanly', () => {
      const plans = [
        makePlan('a', 'not_started'),
        makePlan('b', 'not_started'),
      ];
      const graph = buildGraph(plans);

      const events: PlanChangeEvent[] = [
        { type: 'plan-removed', planId: 'b' },
      ];

      const result = patchGraph(graph, events);
      expect(result.plans.has('b')).toBe(false);
      expect(result.plans.get('a')).toBe(graph.plans.get('a'));
    });
  });

  describe('mixed batch', () => {
    it('handles remove + add + update in one batch', () => {
      const plans = [
        makePlan('a', 'done'),
        makePlan('b', 'not_started', ['a']),
        makePlan('c', 'not_started'),
      ];
      const graph = buildGraph(plans);

      const planD = makePlan('d', 'done');
      const updatedB = makePlan('b', 'not_started', ['d']);
      const updatedC = makePlan('c', 'in_progress');

      const events: PlanChangeEvent[] = [
        { type: 'plan-removed', planId: 'a' },
        { type: 'plan-added', planId: 'd', plan: planD },
        { type: 'plan-updated', planId: 'b', file: 'readme', plan: updatedB },
        { type: 'plan-updated', planId: 'c', file: 'readme', plan: updatedC },
      ];

      const result = patchGraph(graph, events);
      expect(result.plans.has('a')).toBe(false);
      expect(result.plans.has('d')).toBe(true);
      expect(result.dependencies.get('b')).toEqual(['d']);
      expect(result.ready.has('b')).toBe(true); // d is done
      expect(result.ready.has('c')).toBe(false); // c is in_progress
    });
  });

  describe('referential equality', () => {
    it('preserves unchanged node references after single update', () => {
      const plans = [
        makePlan('a', 'not_started'),
        makePlan('b', 'not_started'),
        makePlan('c', 'not_started'),
      ];
      const graph = buildGraph(plans);

      const updatedA = makePlan('a', 'in_progress');
      const events: PlanChangeEvent[] = [
        { type: 'plan-updated', planId: 'a', file: 'readme', plan: updatedA },
      ];

      const result = patchGraph(graph, events);
      expect(result.plans.get('a')).toBe(updatedA);
      expect(result.plans.get('b')).toBe(graph.plans.get('b'));
      expect(result.plans.get('c')).toBe(graph.plans.get('c'));
    });
  });

  describe('pure function', () => {
    it('does not mutate the original graph', () => {
      const plans = [
        makePlan('a', 'not_started'),
        makePlan('b', 'not_started', ['a']),
      ];
      const graph = buildGraph(plans);
      const origPlansSize = graph.plans.size;
      const origReadySize = graph.ready.size;
      const origBlockedSize = graph.blocked.size;

      const updatedA = makePlan('a', 'done');
      const events: PlanChangeEvent[] = [
        { type: 'plan-updated', planId: 'a', file: 'readme', plan: updatedA },
      ];

      patchGraph(graph, events);

      // Original graph is unchanged
      expect(graph.plans.size).toBe(origPlansSize);
      expect(graph.ready.size).toBe(origReadySize);
      expect(graph.blocked.size).toBe(origBlockedSize);
      expect(graph.plans.get('a')!.frontmatter.status).toBe('not_started');
    });
  });

  describe('edge cases', () => {
    it('handles adding a plan that no one depends on', () => {
      const plans = [makePlan('a', 'not_started')];
      const graph = buildGraph(plans);

      const newPlan = makePlan('z', 'draft');
      const events: PlanChangeEvent[] = [
        { type: 'plan-added', planId: 'z', plan: newPlan },
      ];

      const result = patchGraph(graph, events);
      expect(result.plans.has('z')).toBe(true);
      expect(result.ready.has('z')).toBe(false); // draft, not not_started
      expect(result.dependents.get('z')).toEqual([]);
    });

    it('handles removing a plan that does not exist in graph', () => {
      const plans = [makePlan('a', 'not_started')];
      const graph = buildGraph(plans);

      const events: PlanChangeEvent[] = [
        { type: 'plan-removed', planId: 'nonexistent' },
      ];

      const result = patchGraph(graph, events);
      // Should not throw, returns a new graph
      expect(result.plans.size).toBe(1);
    });

    it('handles update for a plan not in graph (treats as add)', () => {
      const plans = [makePlan('a', 'not_started')];
      const graph = buildGraph(plans);

      const newPlan = makePlan('b', 'not_started');
      const events: PlanChangeEvent[] = [
        { type: 'plan-updated', planId: 'b', file: 'readme', plan: newPlan },
      ];

      const result = patchGraph(graph, events);
      expect(result.plans.has('b')).toBe(true);
      expect(result.ready.has('b')).toBe(true);
    });

    it('recomputes dependents status when dependency plan status changes', () => {
      // a (done) -> b (not_started, ready) -> c (not_started, blocked)
      const plans = [
        makePlan('a', 'done'),
        makePlan('b', 'not_started', ['a']),
        makePlan('c', 'not_started', ['b']),
      ];
      const graph = buildGraph(plans);
      expect(graph.ready.has('b')).toBe(true);
      expect(graph.blocked.has('c')).toBe(true);

      // Mark b as done
      const updatedB = makePlan('b', 'done', ['a']);
      const events: PlanChangeEvent[] = [
        { type: 'plan-updated', planId: 'b', file: 'readme', plan: updatedB },
      ];

      const result = patchGraph(graph, events);
      expect(result.ready.has('b')).toBe(false);
      expect(result.blocked.has('c')).toBe(false);
      expect(result.ready.has('c')).toBe(true);
    });

    it('dep change to non-done plan makes it blocked', () => {
      const plans = [
        makePlan('a', 'done'),
        makePlan('b', 'not_started'),
        makePlan('c', 'not_started', ['a']),
      ];
      const graph = buildGraph(plans);
      expect(graph.ready.has('c')).toBe(true); // a is done

      // Change c to depend on b (not_started) instead of a (done)
      const updatedC = makePlan('c', 'not_started', ['b']);
      const events: PlanChangeEvent[] = [
        { type: 'plan-updated', planId: 'c', file: 'readme', plan: updatedC },
      ];

      const result = patchGraph(graph, events);
      expect(result.ready.has('c')).toBe(false);
      expect(result.blocked.has('c')).toBe(true);
      expect(result.dependencies.get('c')).toEqual(['b']);
    });

    it('added plan with non-done dependency is blocked', () => {
      const plans = [makePlan('a', 'not_started')];
      const graph = buildGraph(plans);

      const newPlan = makePlan('b', 'not_started', ['a']);
      const events: PlanChangeEvent[] = [
        { type: 'plan-added', planId: 'b', plan: newPlan },
      ];

      const result = patchGraph(graph, events);
      expect(result.plans.has('b')).toBe(true);
      expect(result.blocked.has('b')).toBe(true);
      expect(result.ready.has('b')).toBe(false);
    });

    it('removing a plan blocks multiple dependents (fan-out)', () => {
      const plans = [
        makePlan('a', 'done'),
        makePlan('b', 'not_started', ['a']),
        makePlan('c', 'not_started', ['a']),
      ];
      const graph = buildGraph(plans);
      expect(graph.ready.has('b')).toBe(true);
      expect(graph.ready.has('c')).toBe(true);

      const events: PlanChangeEvent[] = [
        { type: 'plan-removed', planId: 'a' },
      ];

      const result = patchGraph(graph, events);
      expect(result.plans.has('a')).toBe(false);
      expect(result.blocked.has('b')).toBe(true);
      expect(result.blocked.has('c')).toBe(true);
    });

    it('two plans added in same batch where one depends on the other', () => {
      const graph = buildGraph([]);

      const planA = makePlan('a', 'done');
      const planB = makePlan('b', 'not_started', ['a']);
      const events: PlanChangeEvent[] = [
        { type: 'plan-added', planId: 'a', plan: planA },
        { type: 'plan-added', planId: 'b', plan: planB },
      ];

      const result = patchGraph(graph, events);
      expect(result.plans.has('a')).toBe(true);
      expect(result.plans.has('b')).toBe(true);
      expect(result.dependencies.get('b')).toEqual(['a']);
      expect(result.dependents.get('a')).toContain('b');
      expect(result.ready.has('b')).toBe(true);
    });

    it('two plans added in same batch, dependent added before dependency', () => {
      const graph = buildGraph([]);

      const planA = makePlan('a', 'done');
      const planB = makePlan('b', 'not_started', ['a']);
      // b added first (before a exists in graph)
      const events: PlanChangeEvent[] = [
        { type: 'plan-added', planId: 'b', plan: planB },
        { type: 'plan-added', planId: 'a', plan: planA },
      ];

      const result = patchGraph(graph, events);
      expect(result.plans.has('a')).toBe(true);
      expect(result.plans.has('b')).toBe(true);
      // a's add should resolve b's dangling dep
      expect(result.dependencies.get('b')).toContain('a');
      expect(result.dependents.get('a')).toContain('b');
      expect(result.ready.has('b')).toBe(true);
    });

    it('two updates to done in same batch unblock downstream', () => {
      // c depends on both a and b; both are not_started
      const plans = [
        makePlan('a', 'not_started'),
        makePlan('b', 'not_started'),
        makePlan('c', 'not_started', ['a', 'b']),
      ];
      const graph = buildGraph(plans);
      expect(graph.blocked.has('c')).toBe(true);

      const updatedA = makePlan('a', 'done');
      const updatedB = makePlan('b', 'done');
      const events: PlanChangeEvent[] = [
        { type: 'plan-updated', planId: 'a', file: 'readme', plan: updatedA },
        { type: 'plan-updated', planId: 'b', file: 'readme', plan: updatedB },
      ];

      const result = patchGraph(graph, events);
      expect(result.ready.has('c')).toBe(true);
      expect(result.blocked.has('c')).toBe(false);
    });

    it('duplicate update events for same plan uses last value', () => {
      const plans = [makePlan('a', 'not_started')];
      const graph = buildGraph(plans);

      const updatedA1 = makePlan('a', 'in_progress');
      updatedA1.frontmatter.title = 'First Update';
      const updatedA2 = makePlan('a', 'done');
      updatedA2.frontmatter.title = 'Second Update';

      const events: PlanChangeEvent[] = [
        { type: 'plan-updated', planId: 'a', file: 'readme', plan: updatedA1 },
        { type: 'plan-updated', planId: 'a', file: 'readme', plan: updatedA2 },
      ];

      const result = patchGraph(graph, events);
      expect(result.plans.get('a')!.frontmatter.title).toBe('Second Update');
      expect(result.plans.get('a')!.frontmatter.status).toBe('done');
    });

    it('plan updated to remove all dependencies goes from blocked to ready', () => {
      const plans = [
        makePlan('a', 'not_started'),
        makePlan('b', 'not_started', ['a']),
      ];
      const graph = buildGraph(plans);
      expect(graph.blocked.has('b')).toBe(true);

      // Update b to have no dependencies
      const updatedB = makePlan('b', 'not_started');
      const events: PlanChangeEvent[] = [
        { type: 'plan-updated', planId: 'b', file: 'readme', plan: updatedB },
      ];

      const result = patchGraph(graph, events);
      expect(result.ready.has('b')).toBe(true);
      expect(result.blocked.has('b')).toBe(false);
      expect(result.dependencies.get('b')).toEqual([]);
      expect(result.dependents.get('a')).not.toContain('b');
    });

    it('adding a plan resolves dangling deps for multiple existing plans', () => {
      // b and c both depend on a, but a doesn't exist
      const planB = makePlan('b', 'not_started', ['a']);
      const planC = makePlan('c', 'not_started', ['a']);
      const graph = buildGraph([planB, planC]);
      expect(graph.blocked.has('b')).toBe(true);
      expect(graph.blocked.has('c')).toBe(true);

      const planA = makePlan('a', 'done');
      const events: PlanChangeEvent[] = [
        { type: 'plan-added', planId: 'a', plan: planA },
      ];

      const result = patchGraph(graph, events);
      expect(result.dependents.get('a')).toContain('b');
      expect(result.dependents.get('a')).toContain('c');
      expect(result.dependencies.get('b')).toContain('a');
      expect(result.dependencies.get('c')).toContain('a');
      expect(result.ready.has('b')).toBe(true);
      expect(result.ready.has('c')).toBe(true);
    });
  });

  describe('immutability of edge maps', () => {
    it('does not mutate original dependents or dependencies arrays', () => {
      const plans = [
        makePlan('a', 'not_started'),
        makePlan('b', 'not_started', ['a']),
      ];
      const graph = buildGraph(plans);
      const origDependentsA = [...(graph.dependents.get('a') ?? [])];
      const origDependenciesB = [...(graph.dependencies.get('b') ?? [])];

      // Add a new plan that depends on a
      const newPlan = makePlan('c', 'not_started', ['a']);
      const events: PlanChangeEvent[] = [
        { type: 'plan-added', planId: 'c', plan: newPlan },
      ];

      patchGraph(graph, events);

      // Original graph arrays must be unchanged
      expect(graph.dependents.get('a')).toEqual(origDependentsA);
      expect(graph.dependencies.get('b')).toEqual(origDependenciesB);
    });
  });
});
