import { filterPlans, pickNext } from '../../core/index.ts';
import type { Plan } from '../../core/types.ts';
import type { GraphData } from '../../core/graph.ts';
import type { PlanSummary, ReadyResult } from '../../api.ts';

export interface ComputeReadyOptions {
  plans: Plan[];
  graph: GraphData;
  filters?: { tag?: string; repo?: string };
  toSummary: (p: Plan) => PlanSummary;
}

export function computeReady(opts: ComputeReadyOptions): ReadyResult {
  const { plans, graph, filters, toSummary } = opts;

  let readyPlans = plans.filter(p => graph.ready.has(p.id));
  readyPlans = filterPlans(readyPlans, { tag: filters?.tag, repo: filters?.repo });

  const filteredIds = new Set(readyPlans.map(p => p.id));
  const next = pickNext(graph, filteredIds);

  return {
    plans: readyPlans.map(p => toSummary(p)),
    next,
  };
}
