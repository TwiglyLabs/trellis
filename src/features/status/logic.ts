import { filterPlans, computeChunks, toSummary as defaultToSummary } from '../../core/index.ts';
import type { Plan, TrellisConfig, PlanSummary, BlockedPlanSummary } from '../../core/types.ts';
import type { GraphData } from '../../core/graph.ts';

export interface StatusResult {
  project: string;
  total: number;
  chunks: { total: number; overBudget: number };
  byStatus: {
    ready: PlanSummary[];
    blocked: BlockedPlanSummary[];
    inProgress: PlanSummary[];
    draft: PlanSummary[];
    done: PlanSummary[];
    archived: PlanSummary[];
  };
}

export interface ComputeStatusOptions {
  plans: Plan[];
  config: TrellisConfig;
  graph: GraphData;
  filters?: { tag?: string; repo?: string; showDone?: boolean; showArchived?: boolean };
  toSummary?: (p: Plan) => PlanSummary;
}

export function computeStatus(opts: ComputeStatusOptions): StatusResult {
  const { plans: allPlansRaw, config, graph, filters, toSummary = defaultToSummary } = opts;

  // Display local plans only — remote plans are in the graph for dep resolution but not shown
  const localPlansRaw = allPlansRaw.filter(p => p.repoAlias == null);
  const allPlans = filterPlans(localPlansRaw, { tag: filters?.tag, repo: filters?.repo });
  const total = allPlans.length;

  let plans = allPlans;
  if (!filters?.showDone) {
    plans = plans.filter(p => p.frontmatter.status !== 'done');
  }
  if (!filters?.showArchived) {
    plans = plans.filter(p => p.frontmatter.status !== 'archived');
  }

  const chunkResult = computeChunks(allPlansRaw, graph, {
    maxLines: config.chunk_max_lines,
    strategy: config.chunk_strategy,
  });
  const overBudget = chunkResult.chunks.filter(c => c.totalLines > chunkResult.config.maxLines).length;

  const ready = plans.filter(p => graph.ready.has(p.id)).map(p => toSummary(p));
  const blocked: BlockedPlanSummary[] = plans.filter(p => graph.blocked.has(p.id)).map(p => {
    const waitingOn = (p.frontmatter.depends_on ?? []).filter(d => {
      const dep = graph.plans.get(d);
      return !dep || dep.frontmatter.status !== 'done';
    });
    return { ...toSummary(p), waitingOn };
  });
  const inProgress = plans.filter(p => p.frontmatter.status === 'in_progress').map(p => toSummary(p));
  const draft = plans.filter(p => p.frontmatter.status === 'draft').map(p => toSummary(p));
  const done = plans.filter(p => p.frontmatter.status === 'done').map(p => toSummary(p));
  const archived = plans.filter(p => p.frontmatter.status === 'archived').map(p => toSummary(p));

  return {
    project: config.project,
    total,
    chunks: { total: chunkResult.chunks.length, overBudget },
    byStatus: { ready, blocked, inProgress, draft, done, archived },
  };
}
