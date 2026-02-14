import chalk from 'chalk';
import { join } from 'path';
import { loadConfig, scanPlans } from '../scanner.ts';
import { buildGraph, pickNext } from '../graph.ts';
import { padRight, computeColumnWidth, filterPlans } from '../utils.ts';

interface ReadyOptions {
  tag?: string;
  repo?: string;
  json?: boolean;
  next?: boolean;
}

export function readyCommand(options: ReadyOptions): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);
  const graph = buildGraph(plans);

  let readyPlans = plans.filter(p => graph.ready.has(p.id));
  readyPlans = filterPlans(readyPlans, options);

  if (options.next) {
    const filteredIds = new Set(readyPlans.map(p => p.id));
    const nextId = pickNext(graph, filteredIds);
    const nextPlan = nextId ? graph.plans.get(nextId)! : null;

    if (options.json) {
      if (!nextPlan) {
        console.log(JSON.stringify(null));
      } else {
        console.log(JSON.stringify({
          id: nextPlan.id,
          title: nextPlan.frontmatter.title,
          status: nextPlan.frontmatter.status,
          depends_on: nextPlan.frontmatter.depends_on ?? [],
          tags: nextPlan.frontmatter.tags ?? [],
          repo: nextPlan.frontmatter.repo,
          description: nextPlan.frontmatter.description,
          assignee: nextPlan.frontmatter.assignee,
        }, null, 2));
      }
      return;
    }

    if (!nextPlan) {
      console.log('No plans are ready.');
      return;
    }

    const desc = nextPlan.frontmatter.description || nextPlan.frontmatter.title;
    const tags = nextPlan.frontmatter.repo ? `[${nextPlan.frontmatter.repo}]` : '';
    console.log(`${nextPlan.id} ${padRight(desc, 40)} ${tags}`.trim());
    return;
  }

  if (options.json) {
    const output = readyPlans.map(p => ({
      id: p.id,
      title: p.frontmatter.title,
      status: p.frontmatter.status,
      depends_on: p.frontmatter.depends_on ?? [],
      tags: p.frontmatter.tags ?? [],
      repo: p.frontmatter.repo,
      description: p.frontmatter.description,
      assignee: p.frontmatter.assignee,
    }));
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (readyPlans.length === 0) {
    console.log('No plans are ready.');
    return;
  }

  const idWidth = computeColumnWidth(readyPlans.map(p => p.id));

  for (const p of readyPlans) {
    const desc = p.frontmatter.description || p.frontmatter.title;
    const tags = p.frontmatter.repo ? `[${p.frontmatter.repo}]` : '';
    console.log(`${chalk.white(padRight(p.id, idWidth))} ${padRight(desc, 40)} ${chalk.dim(tags)}`);
  }
}
