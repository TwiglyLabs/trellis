import type { Plan, RecentActivity } from '../../core/types.ts';
import { computeRecentActivity } from '../../recency.ts';

export interface RecentResult {
  since: string;  // ISO 8601
  contentChanged: RecentPlanEntry[];
  statusChanged: RecentPlanEntry[];
  newlyCreated: RecentPlanEntry[];
}

export interface RecentPlanEntry {
  id: string;
  title: string;
  status: string;
  updatedAt: string;  // ISO 8601
}

export interface ComputeRecentOptions {
  plans: Plan[];
  days?: number;
}

function toEntry(plan: Plan): RecentPlanEntry {
  return {
    id: plan.id,
    title: plan.frontmatter.title,
    status: plan.frontmatter.status,
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export function computeRecent(opts: ComputeRecentOptions): RecentResult {
  const days = opts.days ?? 1;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const activity: RecentActivity = computeRecentActivity(opts.plans, since);

  return {
    since: since.toISOString(),
    contentChanged: activity.contentChanged.map(toEntry),
    statusChanged: activity.statusChanged.map(toEntry),
    newlyCreated: activity.newlyCreated.map(toEntry),
  };
}
