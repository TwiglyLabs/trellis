import chalk from 'chalk';
import type { Command } from 'commander';
import { createContext } from '../../core/index.ts';
import type { PlanSummary } from '../../core/types.ts';
import { padRight, computeColumnWidth, resolveProjectPlans, buildReposArray } from '../../core/utils.ts';
import { computeEpic } from './logic.ts';
import { computeGraph } from '../graph/logic.ts';

export function register(program: Command): void {
  program
    .command('epic [name]')
    .description('Show epic completion status')
    .option('--json', 'Output as JSON')
    .option('--offline', 'Skip remote fetch, use cache or local only')
    .option('--project', 'Show plans from all repos in the project')
    .addHelpText('after', '\nExamples:\n  $ trellis epic\n  $ trellis epic v1\n  $ trellis epic --json\n  $ trellis epic --project')
    .action((name, options) => epicCommand(options, name));
}

interface EpicOptions {
  json?: boolean;
  offline?: boolean;
  project?: boolean;
}

function progressBar(ratio: number, width: number): string {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return chalk.green('\u2593'.repeat(filled)) + chalk.dim('\u2591'.repeat(empty));
}

export function epicCommand(options: EpicOptions, name?: string): void {
  const ctx = createContext(process.cwd(), { offline: options.offline });
  const { plans, isProject } = resolveProjectPlans(ctx.plans, ctx.manifest, options.project);
  const epics = computeEpic({ plans, graph: ctx.graph, name });

  if (epics.length === 0) {
    if (name) {
      if (options.json) {
        console.error(JSON.stringify({ error: `Epic "${name}" not found.` }));
      } else {
        console.error(`Epic "${name}" not found.`);
      }
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      console.log(JSON.stringify([]));
    } else {
      console.log('No epics found. Tag plans with epic:<name> to track completion.');
    }
    return;
  }

  if (name) {
    const epic = epics[0];
    const graphResult = computeGraph({ plans, graph: ctx.graph, config: ctx.config });

    if (options.json) {
      const epicPlans = (epic.plans ?? []).map((p) => {
        const node = graphResult.nodes.find((n) => n.id === p.id);
        return {
          id: p.id,
          title: p.title,
          status: p.status,
          blocked: node?.blocked ?? false,
          ready: node?.ready ?? false,
          repoAlias: p.repoAlias ?? null,
        };
      });

      const output: Record<string, unknown> = {
        epic: epic.epic,
        total: epic.total,
        done: epic.done,
        in_progress: epic.inProgress,
        not_started: epic.notStarted,
        blocked: epic.blocked,
        draft: epic.draft,
        progress: epic.progress,
        plans: epicPlans,
      };

      if (isProject) {
        output.repos = buildReposArray(epic.plans ?? [], ctx.config.project);
      }

      console.log(JSON.stringify(output, null, 2));
      return;
    }

    const pct = Math.round(epic.progress * 100);
    console.log(`\n${chalk.bold(name)} — ${epic.done}/${epic.total} done (${pct}%)\n`);

    const epicPlans = epic.plans ?? [];
    const idWidth = computeColumnWidth(epicPlans.map((p) => p.id));

    const done = epicPlans.filter((p) => p.status === 'done');
    const remaining = epicPlans.filter((p) => p.status !== 'done');

    if (remaining.length > 0) {
      console.log(chalk.yellow.bold(`  REMAINING (${remaining.length})`));
      for (const p of remaining) {
        const node = graphResult.nodes.find((n) => n.id === p.id);
        const statusLabel = node?.blocked ? chalk.red('blocked') : chalk.dim(p.status);
        const repoPrefix = isProject && p.repoAlias ? chalk.dim(`[${p.repoAlias}] `) : '';
        console.log(`    ${repoPrefix}${chalk.white(padRight(p.id, idWidth))} ${p.title}  ${statusLabel}`);
      }
      console.log();
    }

    if (done.length > 0) {
      console.log(chalk.green.bold(`  DONE (${done.length})`));
      for (const p of done) {
        const repoPrefix = isProject && p.repoAlias ? chalk.dim(`[${p.repoAlias}] `) : '';
        console.log(`    ${repoPrefix}${chalk.dim(padRight(p.id, idWidth))} ${chalk.dim(p.title)}`);
      }
      console.log();
    }
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(epics.map((e) => ({
      epic: e.epic,
      total: e.total,
      done: e.done,
      in_progress: e.inProgress,
      not_started: e.notStarted,
      blocked: e.blocked,
      draft: e.draft,
      progress: e.progress,
    })), null, 2));
    return;
  }

  const nameWidth = computeColumnWidth(epics.map((e) => e.epic));

  for (const e of epics) {
    const pct = Math.round(e.progress * 100);
    const bar = progressBar(e.progress, 10);
    console.log(`  ${chalk.white(padRight(e.epic, nameWidth))}  ${e.done}/${e.total} done  ${bar}  ${pct}%`);
  }
}

