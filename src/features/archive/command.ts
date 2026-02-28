import chalk from 'chalk';
import type { Command } from 'commander';
import { resolveCliContext, resolvePlanId, parseQualifiedId } from '../../core/index.ts';
import { computeArchive } from './logic.ts';

export function register(program: Command): void {
  program
    .command('archive <plan-id>')
    .description('Archive a plan (set status to archived)')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExamples:\n  $ trellis archive completed-plan\n  $ trellis archive repo:completed-plan')
    .action((planId, options) => archiveCommand(planId, options));
}

interface ArchiveOptions {
  json?: boolean;
}

export function archiveCommand(planId: string, options?: ArchiveOptions): void {
  const ctx = resolveCliContext(process.cwd());

  // In multi-repo mode, resolve qualified/unqualified IDs
  let resolvedId = planId;
  if (ctx.isMultiRepo) {
    const parsed = parseQualifiedId(planId);
    if (parsed.repo) {
      resolvedId = planId;
    } else {
      const resolved = resolvePlanId(ctx.graph, planId);
      resolvedId = resolved.qualifiedId;
    }
  }

  try {
    const result = computeArchive(
      { planId: resolvedId, graph: ctx.graph },
      { refresh: () => {} },
    );

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
