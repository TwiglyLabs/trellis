import { existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { createContext } from '../../core/index.ts';
import { padRight, computeColumnWidth } from '../../core/utils.ts';
import { computeSync } from './logic.ts';
import type { SyncResult } from './logic.ts';

export function register(program: Command): void {
  program
    .command('sync')
    .description('Fetch and cache remote plan state in parallel')
    .option('--repo <alias>', 'Sync only this repo')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExamples:\n  $ trellis sync\n  $ trellis sync --repo canopy\n  $ trellis sync --json')
    .action((options) => syncCommand(options));
}

interface SyncOptions {
  repo?: string;
  json?: boolean;
}

export async function syncCommand(options: SyncOptions): Promise<void> {
  const ctx = createContext(process.cwd());

  if (!ctx.config.manifest && !hasLocalManifest(ctx.projectDir)) {
    const msg = 'No manifest configured. Add "manifest: <git-url>" to your .trellis config or create a .trellis-project file.';
    if (options.json) {
      console.error(JSON.stringify({ error: msg }));
    } else {
      console.error(msg);
    }
    process.exitCode = 1;
    return;
  }

  let result: SyncResult;
  try {
    result = await computeSync({
      config: ctx.config,
      projectDir: ctx.projectDir,
      repo: options.repo,
    });
  } catch (err: any) {
    if (options.json) {
      console.error(JSON.stringify({ error: err.message }));
    } else {
      console.error(err.message);
    }
    process.exitCode = 1;
    return;
  }

  // Exit code: 0 if at least one repo synced, 1 if all failed
  if (result.totalRepos > 0 && result.successfulRepos === 0) {
    process.exitCode = 1;
  }

  if (options.json) {
    console.log(JSON.stringify({
      project: result.project,
      total_plans: result.totalPlans,
      total_repos: result.totalRepos,
      successful_repos: result.successfulRepos,
      duration_ms: result.durationMs,
      repos: result.repos.map(r => ({
        alias: r.alias,
        status: r.status,
        plan_count: r.planCount,
        duration_ms: r.durationMs,
        ...(r.error ? { error: r.error } : {}),
      })),
    }, null, 2));
    return;
  }

  // Human-readable output
  if (result.repos.length === 0) {
    console.log('Nothing to sync — no remote repos in manifest.');
    return;
  }

  const repoWord = result.totalRepos === 1 ? 'repo' : 'repos';
  console.log(`Fetching ${result.totalRepos} ${repoWord}...`);

  const aliasWidth = computeColumnWidth(result.repos.map(r => r.alias));

  for (const repo of result.repos) {
    const icon = repo.status === 'ok' ? chalk.green('✓') : chalk.red('✗');
    const detail = repo.status === 'ok'
      ? chalk.dim(`(${repo.planCount} plans)`)
      : chalk.red(repo.error ?? 'failed');
    console.log(`  ${icon} ${padRight(repo.alias, aliasWidth)} ${detail}`);
  }

  const duration = (result.durationMs / 1000).toFixed(1);
  console.log(`Synced ${result.totalPlans} plans from ${result.successfulRepos}/${result.totalRepos} ${repoWord} in ${duration}s`);
}

function hasLocalManifest(projectDir: string): boolean {
  return existsSync(join(projectDir, '.trellis-project'));
}
