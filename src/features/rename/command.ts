import chalk from 'chalk';
import type { Command } from 'commander';
import { createContext } from '../../core/index.ts';
import { computeRename } from './logic.ts';

export function register(program: Command): void {
  program
    .command('rename <old-id> <new-id>')
    .description('Rename plan and update all references')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExamples:\n  $ trellis rename old-name new-name')
    .action((oldId, newId, options) => renameCommand(oldId, newId, options));
}

interface RenameOptions {
  json?: boolean;
}

export function renameCommand(oldId: string, newId: string, options?: RenameOptions): void {
  const ctx = createContext(process.cwd());

  try {
    const result = computeRename(
      { oldId, newId, plansDir: ctx.plansDir, graph: ctx.graph },
      { refresh: () => {} },
    );

    if (options?.json) {
      console.log(JSON.stringify({
        old_id: result.oldId,
        new_id: result.newId,
        references_updated: result.referencesUpdated,
      }, null, 2));
      return;
    }

    console.log(`${chalk.green('✓')} Renamed ${oldId} → ${newId}`);
    if (result.referencesUpdated.length > 0) {
      console.log(`  Updated depends_on in: ${result.referencesUpdated.join(', ')}`);
    }
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
