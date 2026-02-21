import chalk from 'chalk';
import type { Command } from 'commander';
import { createContext } from '../../core/index.ts';
import type { PlanSummary, BlockedPlanSummary } from '../../core/types.ts';
import { padRight, pluralize, computeColumnWidth, resolveProjectPlans, buildReposArray } from '../../core/utils.ts';
import { computeStatus } from './logic.ts';

export function register(program: Command): void {
  program
    .command('status')
    .description('Dashboard: what\'s ready, blocked, in progress')
    .option('--tag <tag>', 'Filter by tag')
    .option('--repo <repo>', 'Filter by repo')
    .option('--json', 'Output as JSON')
    .option('--all', 'Show all plans including done and archived')
    .option('--done', 'Include done plans')
    .option('--archived', 'Include archived plans')
    .option('--offline', 'Skip remote fetch, use cache or local only')
    .option('--project', 'Show plans from all repos in the project')
    .addHelpText('after', '\nExamples:\n  $ trellis status\n  $ trellis status --tag foundation\n  $ trellis status --json\n  $ trellis status --all\n  $ trellis status --done\n  $ trellis status --project')
    .action((options) => statusCommand(options));
}

interface StatusOptions {
  tag?: string;
  repo?: string;
  json?: boolean;
  all?: boolean;
  done?: boolean;
  archived?: boolean;
  offline?: boolean;
  project?: boolean;
}

export function statusCommand(options: StatusOptions): void {
  const ctx = createContext(process.cwd(), { offline: options.offline });
  const { isProject } = resolveProjectPlans(ctx.plans, ctx.manifest, options.project);

  const showDone = options.all || options.done;
  const showArchived = options.all || options.archived;

  const result = computeStatus({
    plans: ctx.plans,
    config: ctx.config,
    graph: ctx.graph,
    filters: {
      tag: options.tag,
      repo: options.repo,
      showDone,
      showArchived,
      project: isProject,
    },
  });

  const allPlans = [
    ...result.byStatus.ready,
    ...result.byStatus.blocked,
    ...result.byStatus.inProgress,
    ...result.byStatus.draft,
    ...result.byStatus.done,
    ...result.byStatus.archived,
  ];

  if (options.json) {
    const output: Record<string, unknown> = {
      project: result.project,
      total: allPlans.length,
      chunks: {
        total: result.chunks.total,
        over_budget: result.chunks.overBudget,
      },
      plans: allPlans.map((p) => {
        const base: Record<string, unknown> = {
          id: p.id,
          title: p.title,
          status: p.status,
          blocked: false,
          ready: false,
          depends_on: [],
          tags: p.tags,
          repo: p.repo,
          assignee: p.assignee,
          repoAlias: p.repoAlias ?? null,
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

    if (isProject) {
      output.repos = buildReposArray(allPlans, ctx.config.project);
    }

    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (allPlans.length === 0) {
    console.log('No plans found.');
    return;
  }

  if (isProject) {
    printProjectStatus(result, allPlans, ctx.config.project);
  } else {
    printLocalStatus(result, allPlans);
  }
}

function printLocalStatus(
  result: ReturnType<typeof computeStatus>,
  allPlans: (PlanSummary | BlockedPlanSummary)[],
): void {
  const idWidth = computeColumnWidth(allPlans.map((p) => p.id));

  console.log(`\n${chalk.bold(result.project)} — ${pluralize(allPlans.length, 'plan')}\n`);
  printStatusSections(result, idWidth);

  const chunkSummary = result.chunks.overBudget > 0
    ? `Chunks: ${result.chunks.total} discovered (${result.chunks.overBudget} over budget)`
    : `Chunks: ${result.chunks.total} discovered`;
  console.log(chalk.dim('  ' + chunkSummary));
}

function printProjectStatus(
  result: ReturnType<typeof computeStatus>,
  allPlans: (PlanSummary | BlockedPlanSummary)[],
  localProject: string,
): void {
  // Group all plans by repo
  const byRepo = new Map<string, (PlanSummary | BlockedPlanSummary)[]>();
  for (const p of allPlans) {
    const key = p.repoAlias ?? localProject;
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key)!.push(p);
  }

  // Sort: local first, then alphabetical
  const repoKeys = [...byRepo.keys()].sort((a, b) => {
    if (a === localProject) return -1;
    if (b === localProject) return 1;
    return a.localeCompare(b);
  });

  const idWidth = computeColumnWidth(allPlans.map((p) => p.id));

  for (const repoKey of repoKeys) {
    const repoPlans = byRepo.get(repoKey)!;
    const isLocal = repoKey === localProject;
    const label = isLocal ? `${repoKey} (local)` : repoKey;
    console.log(`\n${chalk.bold(label)} — ${pluralize(repoPlans.length, 'plan')}\n`);

    // Build a per-repo result view
    const repoResult = {
      ...result,
      byStatus: {
        ready: result.byStatus.ready.filter(p => (p.repoAlias ?? localProject) === repoKey),
        blocked: result.byStatus.blocked.filter(p => (p.repoAlias ?? localProject) === repoKey),
        inProgress: result.byStatus.inProgress.filter(p => (p.repoAlias ?? localProject) === repoKey),
        draft: result.byStatus.draft.filter(p => (p.repoAlias ?? localProject) === repoKey),
        done: result.byStatus.done.filter(p => (p.repoAlias ?? localProject) === repoKey),
        archived: result.byStatus.archived.filter(p => (p.repoAlias ?? localProject) === repoKey),
      },
    };
    printStatusSections(repoResult, idWidth);
  }

  console.log(`\n${chalk.bold('Project total')}: ${pluralize(allPlans.length, 'plan')}`);
}

function printStatusSections(
  result: { byStatus: ReturnType<typeof computeStatus>['byStatus']; chunks: { total: number; overBudget: number } },
  idWidth: number,
): void {
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
}

function printPlanLine(p: PlanSummary, idWidth: number): void {
  const desc = p.description || p.title;
  const tags = p.repo ? `[${p.repo}]` : '';
  console.log(`    ${chalk.white(padRight(p.id, idWidth))} ${padRight(desc, 40)} ${chalk.dim(tags)}`);
}

