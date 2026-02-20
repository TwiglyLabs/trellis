import chalk from 'chalk';
import { Trellis } from '../api.ts';
import { padRight, pluralize, computeColumnWidth } from '../core/utils.ts';
import type { PlanSummary, BlockedPlanSummary } from '../api.ts';

interface StatusOptions {
  tag?: string;
  repo?: string;
  json?: boolean;
  all?: boolean;
  done?: boolean;
  archived?: boolean;
}

export function statusCommand(options: StatusOptions): void {
  const t = new Trellis(process.cwd());

  const showDone = options.all || options.done;
  const showArchived = options.all || options.archived;

  const result = t.status({
    tag: options.tag,
    repo: options.repo,
    showDone,
    showArchived,
  });

  if (options.json) {
    const allPlans = [
      ...result.byStatus.ready,
      ...result.byStatus.blocked,
      ...result.byStatus.inProgress,
      ...result.byStatus.draft,
      ...result.byStatus.done,
      ...result.byStatus.archived,
    ];

    const output = {
      project: result.project,
      total: allPlans.length,
      chunks: {
        total: result.chunks.total,
        over_budget: result.chunks.overBudget,
      },
      plans: allPlans.map((p) => {
        const base = {
          id: p.id,
          title: p.title,
          status: p.status,
          blocked: false,
          ready: false,
          depends_on: [],
          tags: p.tags,
          repo: p.repo,
          assignee: p.assignee,
        };
        if ('waitingOn' in p) {
          return { ...base, blocked: true, waiting_on: (p as BlockedPlanSummary).waitingOn };
        }
        if (result.byStatus.ready.includes(p as PlanSummary)) {
          return { ...base, ready: true };
        }
        return base;
      }),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const allPlans = [
    ...result.byStatus.ready,
    ...result.byStatus.blocked,
    ...result.byStatus.inProgress,
    ...result.byStatus.draft,
    ...result.byStatus.done,
    ...result.byStatus.archived,
  ];

  if (allPlans.length === 0) {
    console.log('No plans found.');
    return;
  }

  const idWidth = computeColumnWidth(allPlans.map((p) => p.id));

  console.log(`\n${chalk.bold(result.project)} — ${pluralize(allPlans.length, 'plan')}\n`);

  if (result.byStatus.ready.length > 0) {
    console.log(chalk.green.bold(`  READY (${result.byStatus.ready.length})`));
    for (const p of result.byStatus.ready) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  if (result.byStatus.blocked.length > 0) {
    console.log(chalk.red.bold(`  BLOCKED (${result.byStatus.blocked.length})`));
    for (const p of result.byStatus.blocked) {
      console.log(`    ${chalk.white(padRight(p.id, idWidth))} ← waiting on: ${p.waitingOn.join(', ')}`);
    }
    console.log();
  }

  if (result.byStatus.inProgress.length > 0) {
    console.log(chalk.blue.bold(`  IN PROGRESS (${result.byStatus.inProgress.length})`));
    for (const p of result.byStatus.inProgress) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  if (result.byStatus.draft.length > 0) {
    console.log(chalk.yellow.bold(`  DRAFT (${result.byStatus.draft.length})`));
    for (const p of result.byStatus.draft) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  if (result.byStatus.done.length > 0) {
    console.log(chalk.gray.bold(`  DONE (${result.byStatus.done.length})`));
    for (const p of result.byStatus.done) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  if (result.byStatus.archived.length > 0) {
    console.log(chalk.gray.bold(`  ARCHIVED (${result.byStatus.archived.length})`));
    for (const p of result.byStatus.archived) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  const chunkSummary = result.chunks.overBudget > 0
    ? `Chunks: ${result.chunks.total} discovered (${result.chunks.overBudget} over budget)`
    : `Chunks: ${result.chunks.total} discovered`;
  console.log(chalk.dim('  ' + chunkSummary));
}

function printPlanLine(p: PlanSummary, idWidth: number): void {
  const desc = p.description || p.title;
  const tags = p.repo ? `[${p.repo}]` : '';
  console.log(`    ${chalk.white(padRight(p.id, idWidth))} ${padRight(desc, 40)} ${chalk.dim(tags)}`);
}
