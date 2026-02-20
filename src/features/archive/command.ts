import chalk from 'chalk';
import type { Command } from 'commander';
import { Trellis } from '../../api.ts';

export function register(program: Command): void {
  program
    .command('archive <plan-id>')
    .description('Archive a plan (set status to archived)')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExamples:\n  $ trellis archive completed-plan')
    .action((planId, options) => archiveCommand(planId, options));
}

interface ArchiveOptions {
  json?: boolean;
}

export function archiveCommand(planId: string, options?: ArchiveOptions): void {
  const t = new Trellis(process.cwd());

  try {
    const result = t.archive(planId);

    if (options?.json) {
      console.log(JSON.stringify({
        id: result.id,
        previous_status: result.previousStatus,
        status: result.newStatus,
      }, null, 2));
      return;
    }

    console.log(`${chalk.green('✓')} Archived ${planId} (was ${result.previousStatus})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options?.json) {
      console.error(JSON.stringify({ error: message }));
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  }
}
