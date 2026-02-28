import chalk from 'chalk';
import type { Command } from 'commander';
import { resolveCliContext, parseQualifiedId } from '../../core/index.ts';
import { computeRename } from './logic.ts';

export function register(program: Command): void {
  program
    .command('rename <old-id> <new-id>')
    .description('Rename plan and update all references')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExamples:\n  $ trellis rename old-name new-name\n  $ trellis rename repo:old-name new-name')
    .action((oldId, newId, options) => renameCommand(oldId, newId, options));
}

interface RenameOptions {
  json?: boolean;
}

export function renameCommand(oldId: string, newId: string, options?: RenameOptions): void {
  const ctx = resolveCliContext(process.cwd());
  const parsedOld = parseQualifiedId(oldId);

  try {
    let result;

    if (parsedOld.repo) {
      // Cross-repo rename via qualified ID
      if (!ctx.isMultiRepo) {
        throw new Error(
          'Cross-repo operations require a .trellis-project manifest. '
          + 'Set project_root in .trellis/config to point to your meta-repo.',
        );
      }
      // new-id must not be qualified (rename is always within the same repo)
      const parsedNew = parseQualifiedId(newId);
      if (parsedNew.repo) {
        throw new Error('Cannot rename across repos. The new ID must be unqualified.');
      }
      const plansDir = ctx.getPlansDir(parsedOld.repo);

      result = computeRename(
        {
          oldId: `${parsedOld.repo}:${parsedOld.planId}`,
          newId: `${parsedOld.repo}:${newId}`,
          plansDir,
          graph: ctx.graph,
          multiRepo: {
            localOldId: parsedOld.planId,
            localNewId: newId,
            repoAlias: parsedOld.repo,
          },
        },
        { refresh: () => {} },
      );
    } else {
      // Local rename (single-repo or unqualified in multi-repo)
      const plansDir = ctx.isMultiRepo
        ? (() => { throw new Error('In multi-repo mode, use a qualified ID (repo:plan-id) for rename.'); })()
        : ctx.getPlansDir();

      result = computeRename(
        { oldId, newId, plansDir, graph: ctx.graph },
        { refresh: () => {} },
      );
    }

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
