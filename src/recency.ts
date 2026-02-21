import type { Plan, RecentActivity } from './core/types.ts';

/**
 * Group plans by recent activity relative to a cutoff date.
 *
 * - contentChanged: plans whose file content was modified after `since` (by mtime)
 * - statusChanged: plans with a status timestamp (started_at, completed_at, not_started_at) after `since`
 * - newlyCreated: plans whose earliest status timestamp is after `since` (first appeared in that window)
 *
 * A plan can appear in multiple groups. Each group is sorted by updatedAt descending.
 */
export function computeRecentActivity(plans: Plan[], since: Date): RecentActivity {
  const contentChanged: Plan[] = [];
  const statusChanged: Plan[] = [];
  const newlyCreated: Plan[] = [];

  for (const plan of plans) {
    const fm = plan.frontmatter;

    // Content changed: file mtime > since
    if (plan.updatedAt > since) {
      contentChanged.push(plan);
    }

    // Collect status timestamps
    const statusDates = getStatusDates(fm);

    // Status changed: any status timestamp > since
    if (statusDates.some(d => d > since)) {
      statusChanged.push(plan);
    }

    // Newly created: earliest status timestamp is after since
    if (statusDates.length > 0) {
      const earliest = statusDates.reduce((a, b) => (a < b ? a : b));
      if (earliest > since) {
        newlyCreated.push(plan);
      }
    }
  }

  const byUpdatedAtDesc = (a: Plan, b: Plan) => b.updatedAt.getTime() - a.updatedAt.getTime();
  contentChanged.sort(byUpdatedAtDesc);
  statusChanged.sort(byUpdatedAtDesc);
  newlyCreated.sort(byUpdatedAtDesc);

  return { contentChanged, statusChanged, newlyCreated };
}

function getStatusDates(fm: { started_at?: string; completed_at?: string; not_started_at?: string }): Date[] {
  const dates: Date[] = [];
  for (const field of ['started_at', 'completed_at', 'not_started_at'] as const) {
    const val = fm[field];
    if (val) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) dates.push(d);
    }
  }
  return dates;
}
