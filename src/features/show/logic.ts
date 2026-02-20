import { transitiveDependents, computeCriticalPath } from '../../core/index.ts';
import type { PlanStatus } from '../../core/types.ts';
import type { GraphData } from '../../core/graph.ts';
import type { ShowResult } from '../../api.ts';

export interface ComputeShowOptions {
  planId: string;
  graph: GraphData;
}

export function computeShow(opts: ComputeShowOptions): ShowResult | null {
  const { planId, graph } = opts;

  const plan = graph.plans.get(planId);
  if (!plan) return null;

  const fm = plan.frontmatter;
  const directDeps = graph.dependents.get(planId) ?? [];
  const transitive = transitiveDependents(planId, graph);
  const critPath = computeCriticalPath(planId, graph);

  return {
    id: planId,
    filePath: plan.filePath,
    title: fm.title,
    status: fm.status,
    blocked: graph.blocked.has(planId),
    ready: graph.ready.has(planId),
    tags: fm.tags ?? [],
    repo: fm.repo,
    assignee: fm.assignee,
    description: fm.description,
    startedAt: fm.started_at,
    completedAt: fm.completed_at,
    body: plan.body,
    dependsOn: (fm.depends_on ?? []).map((depId: string) => {
      const dep = graph.plans.get(depId);
      return {
        id: depId,
        status: (dep?.frontmatter.status ?? 'not_found') as PlanStatus | 'not_found',
        satisfied: dep ? dep.frontmatter.status === 'done' : false,
      };
    }),
    blocks: [...new Set([...directDeps, ...transitive])],
    criticalPath: critPath,
    inputs: plan.inputs?.sections ?? null,
    outputs: plan.outputs?.sections ?? null,
  };
}
