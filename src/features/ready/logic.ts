import { filterPlans, pickNext, toSummary as defaultToSummary } from '../../core/index.ts';
import type { Plan, PlanSummary } from '../../core/types.ts';
import type { GraphData } from '../../core/graph.ts';

export interface ReadyResult {
  plans: PlanSummary[];
  next: string | null;
}

export interface ComputeReadyOptions {
  plans: Plan[];
  graph: GraphData;
  filters?: { tag?: string; repo?: string };
  toSummary?: (p: Plan) => PlanSummary;
}

export function computeReady(opts: ComputeReadyOptions): ReadyResult {
  const { plans, graph, filters, toSummary = defaultToSummary } = opts;

  // Display local plans only — remote plans are in the graph for dep resolution but not shown
  let readyPlans = plans.filter(p => graph.ready.has(p.id) && p.repoAlias == null);
  readyPlans = filterPlans(readyPlans, { tag: filters?.tag, repo: filters?.repo });

  const filteredIds = new Set(readyPlans.map(p => p.id));
  const next = pickNext(graph, filteredIds);

  return {
    plans: readyPlans.map(p => toSummary(p)),
    next,
  };
}
