import { readFileSync } from 'fs';
import chalk from 'chalk';
import yaml from 'js-yaml';
import type { Command } from 'commander';
import { resolveCliContext } from '../../core/cli-context.ts';
import { computeCreateBatch, type BatchPlanSpec } from './batch.ts';

export function register(program: Command): void {
  program
    .command('create-batch <file>')
    .description('Create multiple plans from a YAML batch file')
    .option('--dry-run', 'Validate without creating files')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExamples:\n  $ trellis create-batch batch.yaml\n  $ trellis create-batch plans.yaml --dry-run\n  $ trellis create-batch plans.yaml --json')
    .action((file, options) => createBatchCommand(file, options));
}

interface CreateBatchOptions {
  dryRun?: boolean;
  json?: boolean;
}

export function createBatchCommand(file: string, options: CreateBatchOptions): void {
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = yaml.load(raw) as Record<string, unknown>;

    if (!parsed?.plans || !Array.isArray(parsed.plans)) {
      throw new Error('Batch file must contain a "plans" array.');
    }

    const plans: BatchPlanSpec[] = parsed.plans;

    const ctx = resolveCliContext(process.cwd());
    if (!ctx.isMultiRepo || !ctx.store) {
      throw new Error(
        'create-batch requires a multi-repo setup. '
        + 'Set project_root in .trellis/config to point to your meta-repo.',
      );
    }

    const result = computeCreateBatch({
      plans,
      store: ctx.store,
      dryRun: options.dryRun,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (options.dryRun) {
      console.log(`Dry run: would create ${result.wouldCreate!.length} plans`);
      for (const p of result.wouldCreate!) {
        console.log(`  + ${p.id}`);
      }
    } else {
      console.log(`${chalk.green('Created')} ${result.created.length} plans`);
      for (const p of result.created) {
        console.log(`  ${chalk.green('+')} ${p.id}`);
      }
    }

    if (result.skipped.length > 0) {
      console.log(`Skipped ${result.skipped.length} (already exist)`);
      for (const p of result.skipped) {
        console.log(`  ${chalk.yellow('~')} ${p.id}`);
      }
    }

    if (result.errors.length > 0) {
      console.log(`Errors: ${result.errors.length}`);
      for (const p of result.errors) {
        console.error(`  ${chalk.red('!')} ${p.id}: ${p.error}`);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.error(JSON.stringify({ error: message }));
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  }
}
