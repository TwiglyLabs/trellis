import { updatePlanFile } from '../../core/index.ts';
import type { PlanStatus } from '../../core/types.ts';
import type { GraphData } from '../../core/graph.ts';

export interface ArchiveResult {
  id: string;
  previousStatus: PlanStatus;
  newStatus: 'archived';
}

export interface ComputeArchiveOptions {
  planId: string;
  graph: GraphData;
}

export interface ComputeArchiveCallbacks {
  refresh: () => void;
}

export function computeArchive(options: ComputeArchiveOptions, callbacks: ComputeArchiveCallbacks): ArchiveResult {
  const { planId, graph } = options;

  const plan = graph.plans.get(planId);
  if (!plan) throw new Error(`Plan "${planId}" not found.`);
  if (plan.repoAlias != null) {
    throw new Error(`Cannot modify remote plan '${planId}'. Write operations are local only.`);
  }

  // Check for active dependents
  const dependents = graph.dependents.get(planId) ?? [];
  const activeDependents = dependents.filter(depId => {
    const dep = graph.plans.get(depId);
    return dep && dep.frontmatter.status !== 'done' && dep.frontmatter.status !== 'archived';
  });

  if (activeDependents.length > 0) {
    throw new Error(`Cannot archive "${planId}" — has active dependents: ${activeDependents.join(', ')}`);
  }

  const previousStatus = plan.frontmatter.status;
  updatePlanFile(plan.filePath, { status: 'archived' });
  callbacks.refresh();

  return { id: planId, previousStatus, newStatus: 'archived' };
}
