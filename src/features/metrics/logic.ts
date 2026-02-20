import type { Plan } from '../../core/types.ts';
import type { PlanMetric, MetricsResult } from '../../api.ts';

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface ComputeMetricsOptions {
  plans: Plan[];
  since?: string;
}

export function computeMetrics(options: ComputeMetricsOptions): MetricsResult {
  const { plans, since } = options;
  const donePlans = plans.filter(p => p.frontmatter.status === 'done');

  let filtered = donePlans;
  if (since) {
    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      throw new Error(`Invalid date: "${since}"`);
    }
    filtered = donePlans.filter(p => {
      if (!p.frontmatter.completed_at) return false;
      return new Date(p.frontmatter.completed_at) >= sinceDate;
    });
  }

  // Sort by completion date (newest first)
  filtered.sort((a, b) => {
    const aDate = a.frontmatter.completed_at ? new Date(a.frontmatter.completed_at).getTime() : 0;
    const bDate = b.frontmatter.completed_at ? new Date(b.frontmatter.completed_at).getTime() : 0;
    return bDate - aDate;
  });

  const planMetrics: PlanMetric[] = filtered.map(p => {
    const fm = p.frontmatter;
    const completedAt = fm.completed_at ? new Date(fm.completed_at).getTime() : null;
    const startedAt = fm.started_at ? new Date(fm.started_at).getTime() : null;
    const notStartedAt = fm.not_started_at ? new Date(fm.not_started_at).getTime() : null;

    const cycleTimeHours = (completedAt && startedAt) ? (completedAt - startedAt) / 3_600_000 : null;
    const queueTimeHours = (startedAt && notStartedAt) ? (startedAt - notStartedAt) / 3_600_000 : null;

    const epicTag = (fm.tags ?? []).find(t => t.startsWith('epic:'));
    const epic = epicTag ? epicTag.slice(5) : null;

    return {
      id: p.id,
      title: fm.title,
      completed_at: fm.completed_at ?? '',
      cycle_time_hours: cycleTimeHours !== null ? Math.round(cycleTimeHours * 10) / 10 : null,
      queue_time_hours: queueTimeHours !== null ? Math.round(queueTimeHours * 10) / 10 : null,
      lines: p.lineCount,
      tags: fm.tags ?? [],
      epic,
      sessions: fm.sessions ?? null,
      deviation: fm.deviation ?? null,
    };
  });

  // Aggregate stats
  const cycleTimes = planMetrics.map(p => p.cycle_time_hours).filter((v): v is number => v !== null);
  const medianCycleTime = median(cycleTimes);

  const plansPerEpic: Record<string, number> = {};
  for (const p of planMetrics) {
    if (p.epic) {
      plansPerEpic[p.epic] = (plansPerEpic[p.epic] ?? 0) + 1;
    }
  }

  return {
    plans: planMetrics,
    total_completed: planMetrics.length,
    median_cycle_time_hours: medianCycleTime,
    plans_per_epic: plansPerEpic,
  };
}
