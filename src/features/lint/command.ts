import chalk from 'chalk';
import { join } from 'path';
import type { Command } from 'commander';
import { createContext } from '../../core/index.ts';
import { computeLint } from './logic.ts';

export function register(program: Command): void {
  program
    .command('lint')
    .description('Find cycles, missing deps, bad frontmatter, and structural issues')
    .option('--strict', 'Exit with error on warnings too')
    .option('--json', 'Output as JSON')
    .option('--fix', 'Auto-scaffold missing files and sections')
    .option('--offline', 'Skip remote fetch, use cache or local only')
    .addHelpText('after', '\nExamples:\n  $ trellis lint\n  $ trellis lint --strict\n  $ trellis lint --json\n  $ trellis lint --fix')
    .action((options) => lintCommand(options));
}

export function lintCommand(options?: { strict?: boolean; json?: boolean; fix?: boolean; offline?: boolean }): void {
  const ctx = createContext(process.cwd(), { offline: options?.offline });
  const result = computeLint({
    plans: ctx.plans,
    graph: ctx.graph,
    projectDir: ctx.projectDir,
    plansDir: join(ctx.projectDir, ctx.config.plans_dir),
    manifest: ctx.manifest,
    projectName: ctx.config.project,
    options: { strict: options?.strict, fix: options?.fix },
  });

  if (options?.json) {
    console.log(JSON.stringify({
      ok: result.ok,
      total: result.total,
      ok_count: result.okCount,
      errors: result.errors.map((e) => ({
        plan_id: e.planId,
        type: e.type,
        message: e.message,
      })),
      warnings: result.warnings.map((w) => ({
        plan_id: w.planId,
        type: w.type,
        message: w.message,
      })),
      structural: {
        errors: result.structural.errors.map((e) => ({
          plan_id: e.planId,
          type: e.type,
          message: e.message,
        })),
        warnings: result.structural.warnings.map((w) => ({
          plan_id: w.planId,
          type: w.type,
          message: w.message,
        })),
      },
      fixed: result.fixed,
    }, null, 2));
  } else {
    // Dependency / frontmatter errors
    const nonStructuralErrors = result.errors.filter(e => e.type !== 'gate_violation');
    const nonStructuralWarnings = result.warnings.filter(w =>
      w.type !== 'missing_inputs' && w.type !== 'missing_outputs' && w.type !== 'inputs_sections'
    );

    for (const e of nonStructuralErrors) {
      console.log(`${chalk.red('✗')} ${e.message}`);
    }
    for (const w of nonStructuralWarnings) {
      console.log(`${chalk.yellow('⚠')} ${w.message}`);
    }

    // Structural section
    if (result.structural.errors.length > 0 || result.structural.warnings.length > 0) {
      console.log('');
      console.log(chalk.bold('Structure'));
      for (const e of result.structural.errors) {
        console.log(`${chalk.red('✗')} ${e.message}`);
      }
      for (const w of result.structural.warnings) {
        console.log(`${chalk.yellow('⚠')} ${w.message}`);
      }
    }

    // Fixed items
    if (result.fixed.length > 0) {
      console.log('');
      console.log(chalk.bold('Fixed'));
      for (const f of result.fixed) {
        console.log(`${chalk.green('✓')} ${f}`);
      }
    }

    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log(`${chalk.green('✓')} ${result.total} plans OK`);
    } else {
      console.log(`${chalk.green('✓')} ${result.okCount} of ${result.total} plans OK`);
    }
  }

  if (result.errors.length > 0) {
    process.exitCode = 1;
  }

  if (options?.strict && result.warnings.length > 0) {
    process.exitCode = 1;
  }
}
