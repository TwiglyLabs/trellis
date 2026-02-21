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
  filters?: { tag?: string; repo?: string; project?: boolean };
  toSummary?: (p: Plan) => PlanSummary;
}

export function computeReady(opts: ComputeReadyOptions): ReadyResult {
  const { plans, graph, filters, toSummary = defaultToSummary } = opts;

  // Display local plans only — unless --project, which shows all repos
  let readyPlans = plans.filter(p => graph.ready.has(p.id) && (filters?.project || p.repoAlias == null));
  readyPlans = filterPlans(readyPlans, { tag: filters?.tag, repo: filters?.repo });

  // --next picks from writable plans only (excludes git-fetched remote plans)
  const localReadyIds = new Set(readyPlans.filter(p => !p.remote).map(p => p.id));
  const next = pickNext(graph, localReadyIds);

  return {
    plans: readyPlans.map(p => toSummary(p)),
    next,
  };
}
