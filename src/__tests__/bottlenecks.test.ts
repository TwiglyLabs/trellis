import { describe, it, expect } from 'vitest';
import { computeBottlenecks } from '../features/bottlenecks/logic.ts';
import type { Plan, TrellisConfig } from '../core/types.ts';
import { buildGraph } from '../core/graph.ts';

const NOW = new Date('2026-02-20T12:00:00Z');

function makePlan(overrides: Partial<Plan> & { id: string; title?: string; status?: string; depends_on?: string[]; started_at?: string; not_started_at?: string; completed_at?: string }): Plan {
  const { id, title = id, status = 'not_started', depends_on, started_at, not_started_at, completed_at, ...rest } = overrides;
  return {
    id,
    filePath: `plans/${id}/README.md`,
    frontmatter: {
      title,
      status: status as any,
      depends_on,
      started_at,
      not_started_at,
      completed_at,
    },
    body: '',
    lineCount: 10,
    updatedAt: rest.updatedAt ?? NOW,
    fileHashes: {},
    ...rest,
  };
}

const defaultConfig: TrellisConfig = { project: 'test', plans_dir: 'plans' };

describe('computeBottlenecks', () => {
  describe('blocking factor', () => {
    it('computes transitive blocking factor for a chain', () => {
      const plans = [
        makePlan({ id: 'a', status: 'in_progress' }),
        makePlan({ id: 'b', status: 'not_started', depends_on: ['a'] }),
        makePlan({ id: 'c', status: 'not_started', depends_on: ['b'] }),
        makePlan({ id: 'd', status: 'not_started', depends_on: ['c'] }),
        makePlan({ id: 'e', status: 'not_started', depends_on: ['d'] }),
        makePlan({ id: 'f', status: 'not_started', depends_on: ['e'] }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.highBlockingPlans[0].id).toBe('a');
      expect(result.highBlockingPlans[0].blockingFactor).toBe(5);
    });

    it('computes blocking factor for two parallel chains from same root', () => {
      const plans = [
        makePlan({ id: 'root', status: 'in_progress' }),
        makePlan({ id: 'chain1-a', status: 'not_started', depends_on: ['root'] }),
        makePlan({ id: 'chain1-b', status: 'not_started', depends_on: ['chain1-a'] }),
        makePlan({ id: 'chain1-c', status: 'not_started', depends_on: ['chain1-b'] }),
        makePlan({ id: 'chain2-a', status: 'not_started', depends_on: ['root'] }),
        makePlan({ id: 'chain2-b', status: 'not_started', depends_on: ['chain2-a'] }),
        makePlan({ id: 'chain2-c', status: 'not_started', depends_on: ['chain2-b'] }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.highBlockingPlans[0].id).toBe('root');
      expect(result.highBlockingPlans[0].blockingFactor).toBe(6);
    });

    it('returns 0 blocking factor for plans with no dependents', () => {
      const plans = [
        makePlan({ id: 'a', status: 'not_started' }),
        makePlan({ id: 'b', status: 'not_started' }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.highBlockingPlans).toHaveLength(0);
    });

    it('excludes done plans from blocking factor', () => {
      const plans = [
        makePlan({ id: 'a', status: 'done', completed_at: '2026-02-19' }),
        makePlan({ id: 'b', status: 'not_started', depends_on: ['a'] }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      // 'a' is done — should not appear in highBlockingPlans
      expect(result.highBlockingPlans.find(p => p.id === 'a')).toBeUndefined();
    });

    it('limits to top 10 by blocking factor', () => {
      const plans: Plan[] = [];
      // Create 12 root plans, each blocking one child
      for (let i = 0; i < 12; i++) {
        plans.push(makePlan({ id: `root-${i}`, status: 'in_progress' }));
        plans.push(makePlan({ id: `child-${i}`, status: 'not_started', depends_on: [`root-${i}`] }));
      }
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.highBlockingPlans.length).toBeLessThanOrEqual(10);
    });
  });

  describe('staleness', () => {
    it('flags in_progress plan past threshold as stale', () => {
      const plans = [
        makePlan({ id: 'old', status: 'in_progress', started_at: '2026-02-01' }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.stalePlans).toHaveLength(1);
      expect(result.stalePlans[0].id).toBe('old');
      expect(result.stalePlans[0].daysInStatus).toBe(19);
    });

    it('does not flag in_progress plan below threshold', () => {
      const plans = [
        makePlan({ id: 'fresh', status: 'in_progress', started_at: '2026-02-10' }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.stalePlans).toHaveLength(0);
    });

    it('flags not_started plan past threshold', () => {
      const plans = [
        makePlan({ id: 'waiting', status: 'not_started', not_started_at: '2026-01-15' }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.stalePlans).toHaveLength(1);
      expect(result.stalePlans[0].id).toBe('waiting');
      expect(result.stalePlans[0].status).toBe('not_started');
    });

    it('respects config override for thresholds', () => {
      const plans = [
        makePlan({ id: 'recent', status: 'in_progress', started_at: '2026-02-15' }),
      ];
      const config: TrellisConfig = { ...defaultConfig, stale_in_progress_days: 3 };
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config, now: NOW });

      expect(result.stalePlans).toHaveLength(1);
      expect(result.stalePlans[0].id).toBe('recent');
    });
  });

  describe('stuck detection', () => {
    it('marks in_progress plan with old started_at and old updatedAt as stuck', () => {
      const plans = [
        makePlan({
          id: 'stuck',
          status: 'in_progress',
          started_at: '2026-02-01',
          updatedAt: new Date('2026-02-02'),
        }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.stuckPlans).toHaveLength(1);
      expect(result.stuckPlans[0].id).toBe('stuck');
    });

    it('does NOT mark plan with old started_at but recent updatedAt as stuck', () => {
      const plans = [
        makePlan({
          id: 'active',
          status: 'in_progress',
          started_at: '2026-02-01',
          updatedAt: new Date('2026-02-19'), // recent content edit
        }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.stuckPlans).toHaveLength(0);
    });

    it('falls back to started_at alone when updatedAt is not available', () => {
      const plans = [
        makePlan({
          id: 'no-recency',
          status: 'in_progress',
          started_at: '2026-02-01',
          // updatedAt will be set to NOW by default in makePlan, let's override
        }),
      ];
      // Override updatedAt to undefined to simulate missing recency data
      (plans[0] as any).updatedAt = undefined;
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.stuckPlans).toHaveLength(1);
      expect(result.stuckPlans[0].id).toBe('no-recency');
    });

    it('does not mark plans below threshold as stuck', () => {
      const plans = [
        makePlan({ id: 'new', status: 'in_progress', started_at: '2026-02-10' }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.stuckPlans).toHaveLength(0);
    });
  });

  describe('layer pressure', () => {
    it('computes pressure ratio for layers', () => {
      const plans = [
        makePlan({ id: 'a', status: 'in_progress' }),
        makePlan({ id: 'b', status: 'not_started', depends_on: ['a'] }),
        makePlan({ id: 'c', status: 'not_started', depends_on: ['a'] }),
        makePlan({ id: 'd', status: 'not_started', depends_on: ['a'] }),
        makePlan({ id: 'e', status: 'not_started', depends_on: ['a'] }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      // Layer 0: a (in_progress), Layer 1: b, c, d, e (blocked)
      const layer1 = result.layerPressure.find(l => l.depth === 1);
      expect(layer1).toBeDefined();
      expect(layer1!.blocked).toBe(4);
      expect(layer1!.inProgress).toBe(0);
      expect(layer1!.ratio).toBe(4); // 4 / max(0, 1) = 4
    });

    it('uses max(inProgress, 1) for denominator', () => {
      const plans = [
        makePlan({ id: 'a', status: 'done', completed_at: '2026-02-19' }),
        makePlan({ id: 'b', status: 'not_started', depends_on: ['a'] }),
        makePlan({ id: 'c', status: 'not_started', depends_on: ['a'] }),
        makePlan({ id: 'd', status: 'not_started', depends_on: ['a'] }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      // Layer 1 has 3 plans (all ready, 0 blocked) — should have ratio 0
      const layer1 = result.layerPressure.find(l => l.depth === 1);
      // These are ready, not blocked, so ratio should be 0
      if (layer1) {
        expect(layer1.ratio).toBe(0);
      }
    });

    it('sorts layers by pressure ratio descending', () => {
      const plans = [
        makePlan({ id: 'a', status: 'in_progress' }),
        makePlan({ id: 'b', status: 'not_started', depends_on: ['a'] }),
        makePlan({ id: 'c', status: 'not_started', depends_on: ['a'] }),
        makePlan({ id: 'd', status: 'in_progress', depends_on: ['b'] }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      // Verify sorted by ratio descending
      for (let i = 1; i < result.layerPressure.length; i++) {
        expect(result.layerPressure[i - 1].ratio).toBeGreaterThanOrEqual(result.layerPressure[i].ratio);
      }
    });
  });

  describe('health summary', () => {
    it('computes correct counts', () => {
      const plans = [
        makePlan({ id: 'a', status: 'in_progress' }),
        makePlan({ id: 'b', status: 'not_started', depends_on: ['a'] }),
        makePlan({ id: 'c', status: 'not_started' }),
        makePlan({ id: 'd', status: 'done', completed_at: '2026-02-19' }),
        makePlan({ id: 'e', status: 'draft' }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.healthSummary.totalPlans).toBe(5); // excludes archived
      expect(result.healthSummary.activePlans).toBe(1); // 'a' in_progress
      expect(result.healthSummary.blockedPlans).toBe(1); // 'b' blocked
      expect(result.healthSummary.estimatedParallelism).toBe(1); // 'c' is ready
    });

    it('excludes archived plans', () => {
      const plans = [
        makePlan({ id: 'a', status: 'not_started' }),
        makePlan({ id: 'b', status: 'archived' }),
      ];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.healthSummary.totalPlans).toBe(1);
    });
  });

  describe('empty graph', () => {
    it('returns all zeroes and empty arrays', () => {
      const plans: Plan[] = [];
      const graph = buildGraph(plans);
      const result = computeBottlenecks({ plans, graph, config: defaultConfig, now: NOW });

      expect(result.highBlockingPlans).toHaveLength(0);
      expect(result.stuckPlans).toHaveLength(0);
      expect(result.stalePlans).toHaveLength(0);
      expect(result.layerPressure).toHaveLength(0);
      expect(result.healthSummary.totalPlans).toBe(0);
      expect(result.healthSummary.activePlans).toBe(0);
      expect(result.healthSummary.blockedPlans).toBe(0);
      expect(result.healthSummary.stuckPlans).toBe(0);
      expect(result.healthSummary.highBlockingPlans).toBe(0);
      expect(result.healthSummary.estimatedParallelism).toBe(0);
    });
  });

  describe('pure function verification', () => {
    it('produces same output for same inputs', () => {
      const plans = [
        makePlan({ id: 'a', status: 'in_progress', started_at: '2026-02-01' }),
        makePlan({ id: 'b', status: 'not_started', depends_on: ['a'] }),
      ];
      const graph = buildGraph(plans);
      const opts = { plans, graph, config: defaultConfig, now: NOW };

      const result1 = computeBottlenecks(opts);
      const result2 = computeBottlenecks(opts);

      expect(result1).toEqual(result2);
    });
  });
});
