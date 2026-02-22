import {
  VALID_STATUSES, validateStatusGate, updatePlanFile, newlyReady,
} from '../../core/index.ts';
import type { PlanStatus, PlanFrontmatter } from '../../core/types.ts';
import type { GraphData } from '../../core/graph.ts';

export interface UpdateResult {
  id: string;
  previousStatus: PlanStatus;
  newStatus: PlanStatus;
  backward: boolean;
  newlyReady: string[];
}

const STATUS_ORDER: Record<string, number> = {
  draft: 0,
  not_started: 1,
  in_progress: 2,
  done: 3,
  archived: 4,
};

export interface ComputeUpdateOptions {
  planId: string;
  status: PlanStatus;
  graph: GraphData;
  force?: boolean;
}

export function computeUpdate(opts: ComputeUpdateOptions): UpdateResult {
  const { planId, status, graph, force } = opts;

  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const plan = graph.plans.get(planId);
  if (!plan) {
    throw new Error(`Plan "${planId}" not found.`);
  }
  if (plan.remote) {
    throw new Error(`Cannot modify remote plan '${planId}'. Write operations are local only.`);
  }

  // Gate validation (skip with --force)
  if (!force) {
    const hasDependents = (graph.dependents.get(planId) ?? []).length > 0;
    const gate = validateStatusGate(plan, status, hasDependents);
    if (!gate.pass) {
      const details = gate.missing.map((m: string) => `  - ${m}`).join('\n');
      throw new Error(`Cannot transition "${planId}" to ${status}:\n${details}\n\nUse --force to bypass.`);
    }
  }

  const previousStatus = plan.frontmatter.status;
  const oldOrder = STATUS_ORDER[previousStatus] ?? 0;
  const newOrder = STATUS_ORDER[status] ?? 0;
  const backward = newOrder < oldOrder;

  const updates: Partial<PlanFrontmatter> = { status };
  const deleteFields: string[] = [];

  if (status === 'not_started' && !plan.frontmatter.not_started_at) {
    updates.not_started_at = new Date().toISOString();
  }
  if (status === 'in_progress' && !plan.frontmatter.started_at) {
    updates.started_at = new Date().toISOString();
  }
  if (status === 'done' && !plan.frontmatter.completed_at) {
    updates.completed_at = new Date().toISOString();
  }
  if (backward) {
    if (newOrder < STATUS_ORDER.not_started && plan.frontmatter.not_started_at) {
      deleteFields.push('not_started_at');
    }
    if (newOrder < STATUS_ORDER.in_progress && plan.frontmatter.started_at) {
      deleteFields.push('started_at');
    }
    if (newOrder < STATUS_ORDER.done && plan.frontmatter.completed_at) {
      deleteFields.push('completed_at');
    }
  }

  updatePlanFile(plan.filePath, updates, deleteFields.length > 0 ? deleteFields : undefined);

  const ready = newlyReady(planId, status, graph);

  return {
    id: planId,
    previousStatus,
    newStatus: status,
    backward,
    newlyReady: ready,
  };
}
