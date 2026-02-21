import chalk from 'chalk';
import type { Command } from 'commander';
import { createContext } from '../../core/index.ts';
import { padRight, computeColumnWidth } from '../../core/utils.ts';
import { computeRecent } from './logic.ts';

export function register(program: Command): void {
  program
    .command('recent')
    .description('Show recently modified plans')
    .option('--days <n>', 'Time window in days (default: 1)', parseFloat)
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExamples:\n  $ trellis recent\n  $ trellis recent --days 7\n  $ trellis recent --json')
    .action((options) => recentCommand(options));
}

interface RecentOptions {
  days?: number;
  json?: boolean;
}

export function recentCommand(options: RecentOptions): void {
  if (options.days !== undefined && (isNaN(options.days) || options.days <= 0)) {
    const msg = '--days must be a positive number';
    if (options.json) {
      console.error(JSON.stringify({ error: msg }));
    } else {
      console.error(msg);
    }
    process.exitCode = 1;
    return;
  }

  const ctx = createContext(process.cwd());
  const result = computeRecent({ plans: ctx.plans, days: options.days });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const totalUnique = new Set([
    ...result.contentChanged.map(p => p.id),
    ...result.statusChanged.map(p => p.id),
    ...result.newlyCreated.map(p => p.id),
  ]).size;

  if (totalUnique === 0) {
    const days = options.days ?? 1;
    console.log(`No plans modified in the last ${days === 1 ? '24 hours' : `${days} days`}.`);
    return;
  }

  const allEntries = [...result.contentChanged, ...result.statusChanged, ...result.newlyCreated];
  const idWidth = computeColumnWidth(allEntries.map(p => p.id));

  if (result.contentChanged.length > 0) {
    console.log(chalk.bold(`\n  Content changed (${result.contentChanged.length})`));
    for (const p of result.contentChanged) {
      const age = formatAge(p.updatedAt);
      console.log(`    ${padRight(p.id, idWidth)}  ${p.title}  ${chalk.dim(age)}`);
    }
  }

  if (result.statusChanged.length > 0) {
    console.log(chalk.bold(`\n  Status changed (${result.statusChanged.length})`));
    for (const p of result.statusChanged) {
      const age = formatAge(p.updatedAt);
      console.log(`    ${padRight(p.id, idWidth)}  ${p.title}  ${chalk.dim(p.status)}  ${chalk.dim(age)}`);
    }
  }

  if (result.newlyCreated.length > 0) {
    console.log(chalk.bold(`\n  Newly created (${result.newlyCreated.length})`));
    for (const p of result.newlyCreated) {
      const age = formatAge(p.updatedAt);
      console.log(`    ${padRight(p.id, idWidth)}  ${p.title}  ${chalk.dim(age)}`);
    }
  }

  console.log();
}

function formatAge(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return `${Math.floor(diffMs / (1000 * 60))}m ago`;
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
