import type { Plan, TrellisConfig, BottleneckResult, BlockingPlan, StuckPlan, StalePlan, LayerPressure, HealthSummary } from '../../core/types.ts';
import type { GraphData } from '../../core/graph.ts';
import { transitiveDependents, computeDepths } from '../../core/graph.ts';

const DEFAULT_STALE_IN_PROGRESS_DAYS = 14;
const DEFAULT_STALE_NOT_STARTED_DAYS = 30;

export interface ComputeBottlenecksOptions {
  plans: Plan[];
  graph: GraphData;
  config: TrellisConfig;
  now?: Date;
}

function daysSince(date: Date, now: Date): number {
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
}

export function computeBottlenecks(options: ComputeBottlenecksOptions): BottleneckResult {
  const { plans, graph, config, now = new Date() } = options;

  const staleInProgressDays = config.stale_in_progress_days ?? DEFAULT_STALE_IN_PROGRESS_DAYS;
  const staleNotStartedDays = config.stale_not_started_days ?? DEFAULT_STALE_NOT_STARTED_DAYS;

  // Filter to non-archived plans for all analysis
  const activePlans = plans.filter(p => p.frontmatter.status !== 'archived');

  // --- Blocking factor ---
  const blockingPlans: BlockingPlan[] = [];
  for (const plan of activePlans) {
    const status = plan.frontmatter.status;
    if (status === 'done') continue;
    const transitive = transitiveDependents(plan.id, graph);
    if (transitive.length > 0) {
      blockingPlans.push({
        id: plan.id,
        title: plan.frontmatter.title,
        status,
        blockingFactor: transitive.length,
      });
    }
  }
  blockingPlans.sort((a, b) => b.blockingFactor - a.blockingFactor);
  const highBlockingPlans = blockingPlans.slice(0, 10);

  // --- Staleness ---
  const stalePlans: StalePlan[] = [];
  for (const plan of activePlans) {
    const status = plan.frontmatter.status;
    if (status === 'in_progress' && plan.frontmatter.started_at) {
      const days = daysSince(new Date(plan.frontmatter.started_at), now);
      if (days >= staleInProgressDays) {
        stalePlans.push({ id: plan.id, title: plan.frontmatter.title, status, daysInStatus: Math.floor(days) });
      }
    } else if (status === 'not_started' && plan.frontmatter.not_started_at) {
      const days = daysSince(new Date(plan.frontmatter.not_started_at), now);
      if (days >= staleNotStartedDays) {
        stalePlans.push({ id: plan.id, title: plan.frontmatter.title, status, daysInStatus: Math.floor(days) });
      }
    }
  }

  // --- Stuck detection ---
  const stuckPlans: StuckPlan[] = [];
  for (const plan of activePlans) {
    if (plan.frontmatter.status !== 'in_progress') continue;
    if (!plan.frontmatter.started_at) continue;

    const daysInStatus = daysSince(new Date(plan.frontmatter.started_at), now);
    if (daysInStatus < staleInProgressDays) continue;

    // If updatedAt is available, check if content was recently modified
    if (plan.updatedAt) {
      const daysSinceUpdate = daysSince(plan.updatedAt, now);
      if (daysSinceUpdate < staleInProgressDays) continue; // Active content edits — not stuck
    }

    stuckPlans.push({
      id: plan.id,
      title: plan.frontmatter.title,
      daysInStatus: Math.floor(daysInStatus),
      lastContentUpdate: plan.updatedAt || undefined,
    });
  }

  // --- Layer pressure ---
  const depths = computeDepths(activePlans, graph);
  const layerMap = new Map<number, { blocked: number; inProgress: number }>();

  for (const plan of activePlans) {
    const depth = depths.get(plan.id) ?? 0;
    if (!layerMap.has(depth)) layerMap.set(depth, { blocked: 0, inProgress: 0 });
    const layer = layerMap.get(depth)!;

    if (graph.blocked.has(plan.id)) layer.blocked++;
    if (plan.frontmatter.status === 'in_progress') layer.inProgress++;
  }

  const layerPressure: LayerPressure[] = [];
  for (const [depth, counts] of layerMap) {
    if (counts.blocked === 0 && counts.inProgress === 0) continue;
    const ratio = counts.blocked / Math.max(counts.inProgress, 1);
    layerPressure.push({ depth, blocked: counts.blocked, inProgress: counts.inProgress, ratio: Math.round(ratio * 10) / 10 });
  }
  layerPressure.sort((a, b) => b.ratio - a.ratio);

  // --- Health summary ---
  const inProgressCount = activePlans.filter(p => p.frontmatter.status === 'in_progress').length;
  const blockedCount = activePlans.filter(p => graph.blocked.has(p.id)).length;
  const readyCount = activePlans.filter(p => graph.ready.has(p.id)).length;

  const healthSummary: HealthSummary = {
    totalPlans: activePlans.length,
    activePlans: inProgressCount,
    blockedPlans: blockedCount,
    stuckPlans: stuckPlans.length,
    highBlockingPlans: highBlockingPlans.length,
    estimatedParallelism: readyCount,
  };

  return {
    highBlockingPlans,
    stuckPlans,
    stalePlans,
    layerPressure,
    healthSummary,
  };
}
