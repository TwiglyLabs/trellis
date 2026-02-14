import chalk from 'chalk';
import { join } from 'path';
import { loadConfig, scanPlans } from '../scanner.ts';
import { buildGraph } from '../graph.ts';
import type { GraphData } from '../graph.ts';
import type { Plan } from '../types.ts';
import { padRight, computeColumnWidth } from '../utils.ts';

interface EpicSummary {
  epic: string;
  total: number;
  done: number;
  in_progress: number;
  not_started: number;
  blocked: number;
  draft: number;
  progress: number;
}

interface EpicOptions {
  json?: boolean;
}

function collectEpics(plans: Plan[], graph: GraphData): EpicSummary[] {
  const epicMap = new Map<string, Plan[]>();

  for (const plan of plans) {
    for (const tag of plan.frontmatter.tags ?? []) {
      if (tag.startsWith('epic:')) {
        const name = tag.slice(5);
        if (!epicMap.has(name)) epicMap.set(name, []);
        epicMap.get(name)!.push(plan);
      }
    }
  }

  const summaries: EpicSummary[] = [];
  for (const [epic, epicPlans] of epicMap) {
    const total = epicPlans.length;
    const done = epicPlans.filter(p => p.frontmatter.status === 'done').length;
    summaries.push({
      epic,
      total,
      done,
      in_progress: epicPlans.filter(p => p.frontmatter.status === 'in_progress').length,
      not_started: epicPlans.filter(p => p.frontmatter.status === 'not_started').length,
      blocked: epicPlans.filter(p => graph.blocked.has(p.id)).length,
      draft: epicPlans.filter(p => p.frontmatter.status === 'draft').length,
      progress: total > 0 ? done / total : 0,
    });
  }

  return summaries.sort((a, b) => a.epic.localeCompare(b.epic));
}

function progressBar(ratio: number, width: number): string {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return chalk.green('\u2593'.repeat(filled)) + chalk.dim('\u2591'.repeat(empty));
}

export function epicCommand(options: EpicOptions, name?: string): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);
  const graph = buildGraph(plans);
  const epics = collectEpics(plans, graph);

  if (name) {
    return showSingleEpic(name, epics, plans, graph, options);
  }

  if (epics.length === 0) {
    if (options.json) {
      console.log(JSON.stringify([]));
    } else {
      console.log('No epics found. Tag plans with epic:<name> to track completion.');
    }
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(epics, null, 2));
    return;
  }

  const nameWidth = computeColumnWidth(epics.map(e => e.epic));

  for (const e of epics) {
    const pct = Math.round(e.progress * 100);
    const bar = progressBar(e.progress, 10);
    console.log(`  ${chalk.white(padRight(e.epic, nameWidth))}  ${e.done}/${e.total} done  ${bar}  ${pct}%`);
  }
}

function showSingleEpic(
  name: string,
  epics: EpicSummary[],
  plans: Plan[],
  graph: GraphData,
  options: EpicOptions,
): void {
  const epic = epics.find(e => e.epic === name);

  if (!epic) {
    if (options.json) {
      console.error(JSON.stringify({ error: `Epic "${name}" not found.` }));
    } else {
      console.error(`Epic "${name}" not found.`);
    }
    process.exitCode = 1;
    return;
  }

  const epicPlans = plans.filter(p =>
    (p.frontmatter.tags ?? []).includes(`epic:${name}`)
  );

  if (options.json) {
    console.log(JSON.stringify({
      ...epic,
      plans: epicPlans.map(p => ({
        id: p.id,
        title: p.frontmatter.title,
        status: p.frontmatter.status,
        blocked: graph.blocked.has(p.id),
        ready: graph.ready.has(p.id),
      })),
    }, null, 2));
    return;
  }

  const pct = Math.round(epic.progress * 100);
  console.log(`\n${chalk.bold(name)} — ${epic.done}/${epic.total} done (${pct}%)\n`);

  const idWidth = computeColumnWidth(epicPlans.map(p => p.id));

  const done = epicPlans.filter(p => p.frontmatter.status === 'done');
  const remaining = epicPlans.filter(p => p.frontmatter.status !== 'done');

  if (remaining.length > 0) {
    console.log(chalk.yellow.bold(`  REMAINING (${remaining.length})`));
    for (const p of remaining) {
      const statusLabel = graph.blocked.has(p.id) ? chalk.red('blocked') : chalk.dim(p.frontmatter.status);
      console.log(`    ${chalk.white(padRight(p.id, idWidth))} ${p.frontmatter.title}  ${statusLabel}`);
    }
    console.log();
  }

  if (done.length > 0) {
    console.log(chalk.green.bold(`  DONE (${done.length})`));
    for (const p of done) {
      console.log(`    ${chalk.dim(padRight(p.id, idWidth))} ${chalk.dim(p.frontmatter.title)}`);
    }
    console.log();
  }
}
