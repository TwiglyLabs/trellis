import chalk from 'chalk';
import type { Command } from 'commander';
import { createCachedContext } from '../../core/index.ts';
import type { PlanSummary } from '../../core/types.ts';
import { padRight, computeColumnWidth, resolveProjectPlans, buildReposArray } from '../../core/utils.ts';
import { computeReady } from './logic.ts';
import { computeShow } from '../show/logic.ts';

export function register(program: Command): void {
  program
    .command('ready')
    .description('List plans with all dependencies satisfied')
    .option('--tag <tag>', 'Filter by tag')
    .option('--repo <repo>', 'Filter by repo')
    .option('--json', 'Output as JSON')
    .option('--next', 'Return only the highest-priority ready plan')
    .option('--offline', 'Skip remote fetch, use cache or local only')
    .option('--no-cache', 'Bypass the index and force full rescan')
    .option('--project', 'Show plans from all repos in the project')
    .addHelpText('after', '\nExamples:\n  $ trellis ready\n  $ trellis ready --repo public\n  $ trellis ready --json\n  $ trellis ready --next\n  $ trellis ready --next --json\n  $ trellis ready --project')
    .action((options) => readyCommand(options));
}

interface ReadyOptions {
  tag?: string;
  repo?: string;
  json?: boolean;
  next?: boolean;
  offline?: boolean;
  cache?: boolean;
  project?: boolean;
}

export async function readyCommand(options: ReadyOptions): Promise<void> {
  const { ctx, persist } = createCachedContext(process.cwd(), { offline: options.offline, noCache: options.cache === false });
  try {
    const { isProject } = resolveProjectPlans(ctx.plans, ctx.manifest, options.project);

    const result = computeReady({
      plans: ctx.plans,
      graph: ctx.graph,
      filters: {
        tag: options.tag,
        repo: options.repo,
        project: isProject,
      },
    });

    if (options.next) {
      const nextPlan = result.next ? result.plans.find((p) => p.id === result.next) : null;

      if (options.json) {
        if (!nextPlan) {
          console.log(JSON.stringify(null));
        } else {
          const planDetails = computeShow({ planId: nextPlan.id, graph: ctx.graph });
          console.log(JSON.stringify({
            id: nextPlan.id,
            title: nextPlan.title,
            status: nextPlan.status,
            depends_on: planDetails?.dependsOn.map((d) => d.id) ?? [],
            tags: nextPlan.tags,
            repo: nextPlan.repo,
            description: nextPlan.description,
            assignee: nextPlan.assignee,
            repoAlias: nextPlan.repoAlias ?? null,
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
      const plans = result.plans.map((p) => {
        const planDetails = computeShow({ planId: p.id, graph: ctx.graph });
        return {
          id: p.id,
          title: p.title,
          status: p.status,
          depends_on: planDetails?.dependsOn.map((d) => d.id) ?? [],
          tags: p.tags,
          repo: p.repo,
          description: p.description,
          assignee: p.assignee,
          repoAlias: p.repoAlias ?? null,
        };
      });

      if (isProject) {
        console.log(JSON.stringify({
          plans,
          next: result.next,
          repos: buildReposArray(result.plans, ctx.config.project),
        }, null, 2));
      } else {
        // Backwards compatible: bare array
        console.log(JSON.stringify(plans, null, 2));
      }
      return;
    }

    if (result.plans.length === 0) {
      console.log('No plans are ready.');
      return;
    }

    const idWidth = computeColumnWidth(result.plans.map((p) => p.id));

    if (isProject) {
      // Group by repo
      const byRepo = new Map<string, PlanSummary[]>();
      for (const p of result.plans) {
        const key = p.repoAlias ?? ctx.config.project;
        if (!byRepo.has(key)) byRepo.set(key, []);
        byRepo.get(key)!.push(p);
      }
      const repoKeys = [...byRepo.keys()].sort((a, b) => {
        if (a === ctx.config.project) return -1;
        if (b === ctx.config.project) return 1;
        return a.localeCompare(b);
      });
      for (const repoKey of repoKeys) {
        const isLocal = repoKey === ctx.config.project;
        const label = isLocal ? `${repoKey} (local)` : repoKey;
        console.log(chalk.bold(label));
        for (const p of byRepo.get(repoKey)!) {
          const desc = p.description || p.title;
          const tags = p.repo ? `[${p.repo}]` : '';
          console.log(`  ${chalk.white(padRight(p.id, idWidth))} ${padRight(desc, 40)} ${chalk.dim(tags)}`);
        }
        console.log();
      }
    } else {
      for (const p of result.plans) {
        const desc = p.description || p.title;
        const tags = p.repo ? `[${p.repo}]` : '';
        console.log(`${chalk.white(padRight(p.id, idWidth))} ${padRight(desc, 40)} ${chalk.dim(tags)}`);
      }
    }
  } finally {
    await persist();
  }
}

