import chalk from 'chalk';
import type { Command } from 'commander';
import { Trellis } from '../../api.ts';
import { padRight, computeColumnWidth } from '../../core/utils.ts';

export function register(program: Command): void {
  program
    .command('ready')
    .description('List plans with all dependencies satisfied')
    .option('--tag <tag>', 'Filter by tag')
    .option('--repo <repo>', 'Filter by repo')
    .option('--json', 'Output as JSON')
    .option('--next', 'Return only the highest-priority ready plan')
    .addHelpText('after', '\nExamples:\n  $ trellis ready\n  $ trellis ready --repo public\n  $ trellis ready --json\n  $ trellis ready --next\n  $ trellis ready --next --json')
    .action((options) => readyCommand(options));
}

interface ReadyOptions {
  tag?: string;
  repo?: string;
  json?: boolean;
  next?: boolean;
}

export function readyCommand(options: ReadyOptions): void {
  const t = new Trellis(process.cwd());

  const result = t.ready({
    tag: options.tag,
    repo: options.repo,
  });

  if (options.next) {
    const nextPlan = result.next ? result.plans.find((p) => p.id === result.next) : null;

    if (options.json) {
      if (!nextPlan) {
        console.log(JSON.stringify(null));
      } else {
        const planDetails = t.show(nextPlan.id);
        console.log(JSON.stringify({
          id: nextPlan.id,
          title: nextPlan.title,
          status: nextPlan.status,
          depends_on: planDetails?.dependsOn.map((d) => d.id) ?? [],
          tags: nextPlan.tags,
          repo: nextPlan.repo,
          description: nextPlan.description,
          assignee: nextPlan.assignee,
        }, null, 2));
      }
      return;
    }

    if (!nextPlan) {
      console.log('No plans are ready.');
      return;
    }

    const desc = nextPlan.description || nextPlan.title;
    const tags = nextPlan.repo ? `[${nextPlan.repo}]` : '';
    console.log(`${nextPlan.id} ${padRight(desc, 40)} ${tags}`.trim());
    return;
  }

  if (options.json) {
    const output = result.plans.map((p) => {
      const planDetails = t.show(p.id);
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        depends_on: planDetails?.dependsOn.map((d) => d.id) ?? [],
        tags: p.tags,
        repo: p.repo,
        description: p.description,
        assignee: p.assignee,
      };
    });
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (result.plans.length === 0) {
    console.log('No plans are ready.');
    return;
  }

  const idWidth = computeColumnWidth(result.plans.map((p) => p.id));

  for (const p of result.plans) {
    const desc = p.description || p.title;
    const tags = p.repo ? `[${p.repo}]` : '';
    console.log(`${chalk.white(padRight(p.id, idWidth))} ${padRight(desc, 40)} ${chalk.dim(tags)}`);
  }
}
