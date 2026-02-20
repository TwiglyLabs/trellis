import type { GraphData } from '../../core/graph.ts';
import type { Plan } from '../../core/types.ts';
import type { EpicResult, PlanSummary } from '../../api.ts';

export interface ComputeEpicOptions {
  plans: Plan[];
  graph: GraphData;
  name?: string;
  toSummary: (p: Plan) => PlanSummary;
}

export function computeEpic(options: ComputeEpicOptions): EpicResult[] {
  const { plans, graph, name, toSummary } = options;
  const epicMap = new Map<string, Plan[]>();

  for (const plan of plans) {
    for (const tag of plan.frontmatter.tags ?? []) {
      if (tag.startsWith('epic:')) {
        const epicName = tag.slice(5);
        if (!epicMap.has(epicName)) epicMap.set(epicName, []);
        epicMap.get(epicName)!.push(plan);
      }
    }
  }

  if (name) {
    const epicPlans = epicMap.get(name);
    if (!epicPlans) return [];
    return [buildEpicResult(name, epicPlans, graph, toSummary, true)];
  }

  return [...epicMap.entries()]
    .map(([epicName, epicPlans]) => buildEpicResult(epicName, epicPlans, graph, toSummary, false))
    .sort((a, b) => a.epic.localeCompare(b.epic));
}

function buildEpicResult(
  name: string,
  epicPlans: Plan[],
  graph: GraphData,
  toSummary: (p: Plan) => PlanSummary,
  includePlans: boolean,
): EpicResult {
  const total = epicPlans.length;
  const done = epicPlans.filter(p => p.frontmatter.status === 'done').length;
  const result: EpicResult = {
    epic: name,
    total,
    done,
    inProgress: epicPlans.filter(p => p.frontmatter.status === 'in_progress').length,
    notStarted: epicPlans.filter(p => p.frontmatter.status === 'not_started').length,
    blocked: epicPlans.filter(p => graph.blocked.has(p.id)).length,
    draft: epicPlans.filter(p => p.frontmatter.status === 'draft').length,
    progress: total > 0 ? done / total : 0,
  };
  if (includePlans) {
    result.plans = epicPlans.map(p => toSummary(p));
  }
  return result;
}
