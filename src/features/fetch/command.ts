import chalk from 'chalk';
import type { Command } from 'commander';
import { createContext } from '../../core/index.ts';
import { padRight, computeColumnWidth } from '../../core/utils.ts';
import { computeFetch } from './logic.ts';

export function register(program: Command): void {
  program
    .command('fetch')
    .description('Fetch plan state from all project repos')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExamples:\n  $ trellis fetch\n  $ trellis fetch --json')
    .action((options) => fetchCommand(options));
}

interface FetchOptions {
  json?: boolean;
}

export function fetchCommand(options: FetchOptions): void {
  const ctx = createContext(process.cwd());

  if (!ctx.config.manifest) {
    if (options.json) {
      console.error(JSON.stringify({ error: 'No manifest configured. Add "manifest: <git-url>" to your .trellis config' }));
    } else {
      console.error('No manifest configured. Add "manifest: <git-url>" to your .trellis config');
    }
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = computeFetch({ config: ctx.config, projectDir: ctx.projectDir });
  } catch (err: any) {
    if (options.json) {
      console.error(JSON.stringify({ error: err.message }));
    } else {
      console.error(err.message);
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({
      project: result.project,
      total_plans: result.totalPlans,
      repos: result.repos.map(r => ({
        alias: r.alias,
        ok: r.ok,
        plan_count: r.planCount,
        ...(r.error ? { error: r.error } : {}),
      })),
    }, null, 2));
    return;
  }

  console.log(`\n${chalk.bold(result.project)} — ${result.totalPlans} remote plans\n`);

  const aliasWidth = computeColumnWidth(result.repos.map(r => r.alias));

  for (const repo of result.repos) {
    const status = repo.ok
      ? chalk.green('ok') + chalk.dim(` (${repo.planCount} plans)`)
      : chalk.red('failed') + (repo.error ? chalk.dim(` — ${repo.error}`) : '');
    console.log(`  ${padRight(repo.alias, aliasWidth)}  ${status}`);
  }
  console.log();
}
