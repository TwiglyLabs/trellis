import chalk from 'chalk';
import { join } from 'path';
import { loadConfig, scanPlans } from '../scanner.ts';
import { buildGraph, newlyReady } from '../graph.ts';
import { updatePlanFile } from '../frontmatter.ts';
import { VALID_STATUSES, padRight, computeColumnWidth } from '../utils.ts';
import type { PlanStatus, PlanFrontmatter } from '../types.ts';

const STATUS_ORDER: Record<string, number> = {
  draft: 0,
  not_started: 1,
  in_progress: 2,
  done: 3,
  archived: 4,
};

interface UpdateOptions {
  json?: boolean;
}

export function updateCommand(planId: string, status: string, options?: UpdateOptions): void {
  if (!VALID_STATUSES.includes(status as PlanStatus)) {
    if (options?.json) {
      console.error(JSON.stringify({ error: `Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}` }));
    } else {
      console.error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);
  const graph = buildGraph(plans);

  const plan = graph.plans.get(planId);
  if (!plan) {
    if (options?.json) {
      console.error(JSON.stringify({ error: `Plan "${planId}" not found.` }));
    } else {
      console.error(`Plan "${planId}" not found.`);
    }
    process.exitCode = 1;
    return;
  }

  const previousStatus = plan.frontmatter.status;
  const oldOrder = STATUS_ORDER[previousStatus] ?? 0;
  const newOrder = STATUS_ORDER[status] ?? 0;
  const deleteFields: string[] = [];

  if (newOrder < oldOrder) {
    if (!options?.json) {
      console.log(chalk.yellow(`⚠ Moving ${planId} backward: ${previousStatus} → ${status}`));
    }
    if (newOrder < STATUS_ORDER.in_progress && plan.frontmatter.started_at) {
      deleteFields.push('started_at');
    }
    if (newOrder < STATUS_ORDER.done && plan.frontmatter.completed_at) {
      deleteFields.push('completed_at');
    }
  }

  const updates: Partial<PlanFrontmatter> = { status: status as PlanStatus };

  if (status === 'in_progress' && !plan.frontmatter.started_at) {
    updates.started_at = new Date().toISOString();
  }
  if (status === 'done' && !plan.frontmatter.completed_at) {
    updates.completed_at = new Date().toISOString();
  }

  updatePlanFile(plan.filePath, updates, deleteFields.length > 0 ? deleteFields : undefined);

  const ready = newlyReady(planId, status, graph);

  if (options?.json) {
    const output = {
      id: planId,
      previous_status: previousStatus,
      status,
      backward: newOrder < oldOrder,
      newly_ready: ready,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`${chalk.green('✓')} ${planId} → ${status}`);

  if (ready.length > 0) {
    const idWidth = computeColumnWidth(ready);
    console.log(`\n  Now ready:`);
    for (const id of ready) {
      const readyPlan = graph.plans.get(id)!;
      console.log(`    ${chalk.white(padRight(id, idWidth))} ${readyPlan.frontmatter.title}`);
    }
  }
}
