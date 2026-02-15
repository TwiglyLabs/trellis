import chalk from 'chalk';
import { join } from 'path';
import { loadConfig, scanPlans } from '../scanner.ts';
import { buildGraph, computeChunks } from '../graph.ts';
import { padRight, pluralize, computeColumnWidth, filterPlans } from '../utils.ts';
import type { Plan } from '../types.ts';

interface StatusOptions {
  tag?: string;
  repo?: string;
  json?: boolean;
  all?: boolean;
  done?: boolean;
  archived?: boolean;
}

export function statusCommand(options: StatusOptions): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);

  if (plans.length === 0) {
    console.log('No plans found.');
    return;
  }

  const graph = buildGraph(plans);
  const chunkResult = computeChunks(plans, graph, { maxLines: config.chunk_max_lines, strategy: config.chunk_strategy });
  const overBudgetCount = chunkResult.chunks.filter(c => c.totalLines > chunkResult.config.maxLines).length;
  let filtered = filterPlans(plans, options);

  // Visibility filtering: hide done/archived by default
  const showDone = options.all || options.done;
  const showArchived = options.all || options.archived;

  if (!showDone) {
    filtered = filtered.filter(p => p.frontmatter.status !== 'done');
  }
  if (!showArchived) {
    filtered = filtered.filter(p => p.frontmatter.status !== 'archived');
  }

  if (options.json) {
    const output = {
      project: config.project,
      total: filtered.length,
      chunks: { total: chunkResult.chunks.length, over_budget: overBudgetCount },
      plans: filtered.map(p => ({
        id: p.id,
        title: p.frontmatter.title,
        status: p.frontmatter.status,
        blocked: graph.blocked.has(p.id),
        ready: graph.ready.has(p.id),
        depends_on: p.frontmatter.depends_on ?? [],
        tags: p.frontmatter.tags ?? [],
        repo: p.frontmatter.repo,
        assignee: p.frontmatter.assignee,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const readyPlans = filtered.filter(p => graph.ready.has(p.id));
  const blockedPlans = filtered.filter(p => graph.blocked.has(p.id));
  const inProgress = filtered.filter(p => p.frontmatter.status === 'in_progress');
  const drafts = filtered.filter(p => p.frontmatter.status === 'draft');
  const done = filtered.filter(p => p.frontmatter.status === 'done');
  const archived = filtered.filter(p => p.frontmatter.status === 'archived');

  const idWidth = computeColumnWidth(filtered.map(p => p.id));

  console.log(`\n${chalk.bold(config.project)} — ${pluralize(filtered.length, 'plan')}\n`);

  if (readyPlans.length > 0) {
    console.log(chalk.green.bold(`  READY (${readyPlans.length})`));
    for (const p of readyPlans) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  if (blockedPlans.length > 0) {
    console.log(chalk.red.bold(`  BLOCKED (${blockedPlans.length})`));
    for (const p of blockedPlans) {
      const waitingOn = (p.frontmatter.depends_on ?? [])
        .filter(d => {
          const dep = graph.plans.get(d);
          return !dep || dep.frontmatter.status !== 'done';
        });
      console.log(`    ${chalk.white(padRight(p.id, idWidth))} ← waiting on: ${waitingOn.join(', ')}`);
    }
    console.log();
  }

  if (inProgress.length > 0) {
    console.log(chalk.blue.bold(`  IN PROGRESS (${inProgress.length})`));
    for (const p of inProgress) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  if (drafts.length > 0) {
    console.log(chalk.yellow.bold(`  DRAFT (${drafts.length})`));
    for (const p of drafts) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  if (done.length > 0) {
    console.log(chalk.gray.bold(`  DONE (${done.length})`));
    for (const p of done) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  if (archived.length > 0) {
    console.log(chalk.gray.bold(`  ARCHIVED (${archived.length})`));
    for (const p of archived) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  // Chunk summary
  const chunkSummary = overBudgetCount > 0
    ? `Chunks: ${chunkResult.chunks.length} discovered (${overBudgetCount} over budget)`
    : `Chunks: ${chunkResult.chunks.length} discovered`;
  console.log(chalk.dim('  ' + chunkSummary));
}

function printPlanLine(p: Plan, idWidth: number): void {
  const desc = p.frontmatter.description || p.frontmatter.title;
  const tags = p.frontmatter.repo ? `[${p.frontmatter.repo}]` : '';
  console.log(`    ${chalk.white(padRight(p.id, idWidth))} ${padRight(desc, 40)} ${chalk.dim(tags)}`);
}
