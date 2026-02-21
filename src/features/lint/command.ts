import chalk from 'chalk';
import { join } from 'path';
import type { Command } from 'commander';
import { createContext } from '../../core/index.ts';
import { resolveProjectPlans, buildReposArray } from '../../core/utils.ts';
import { computeLint } from './logic.ts';
import type { LintIssue } from './logic.ts';

export function register(program: Command): void {
  program
    .command('lint')
    .description('Find cycles, missing deps, bad frontmatter, and structural issues')
    .option('--strict', 'Exit with error on warnings too')
    .option('--json', 'Output as JSON')
    .option('--fix', 'Auto-scaffold missing files and sections')
    .option('--completeness', 'Warn about stub and thin plan sections')
    .option('--offline', 'Skip remote fetch, use cache or local only')
    .option('--project', 'Show plans from all repos in the project')
    .addHelpText('after', '\nExamples:\n  $ trellis lint\n  $ trellis lint --strict\n  $ trellis lint --json\n  $ trellis lint --fix\n  $ trellis lint --completeness\n  $ trellis lint --project')
    .action((options) => lintCommand(options));
}

export function lintCommand(options?: { strict?: boolean; json?: boolean; fix?: boolean; completeness?: boolean; offline?: boolean; project?: boolean }): void {
  const ctx = createContext(process.cwd(), { offline: options?.offline });
  const { isProject } = resolveProjectPlans(ctx.plans, ctx.manifest, options?.project);

  const result = computeLint({
    plans: ctx.plans,
    graph: ctx.graph,
    projectDir: ctx.projectDir,
    plansDir: join(ctx.projectDir, ctx.config.plans_dir),
    manifest: ctx.manifest,
    projectName: ctx.config.project,
    options: { strict: options?.strict, fix: options?.fix, completeness: options?.completeness },
  });

  if (options?.json) {
    const mapIssue = (e: LintIssue) => {
      const base: Record<string, unknown> = {
        plan_id: e.planId,
        type: e.type,
        message: e.message,
      };
      if (isProject) {
        const colonIdx = e.planId.indexOf(':');
        base.repoAlias = colonIdx === -1 ? null : e.planId.substring(0, colonIdx);
      }
      return base;
    };

    const output: Record<string, unknown> = {
      ok: result.ok,
      total: result.total,
      ok_count: result.okCount,
      errors: result.errors.map(mapIssue),
      warnings: result.warnings.map(mapIssue),
      structural: {
        errors: result.structural.errors.map(mapIssue),
        warnings: result.structural.warnings.map(mapIssue),
      },
      fixed: result.fixed,
    };

    if (isProject) {
      // Build repos array from all unique plan IDs in issues
      const allPlanIds = new Set<string>();
      for (const e of result.errors) allPlanIds.add(e.planId);
      for (const w of result.warnings) allPlanIds.add(w.planId);
      const items = [...allPlanIds].map(id => {
        const colonIdx = id.indexOf(':');
        return { repoAlias: colonIdx === -1 ? undefined : id.substring(0, colonIdx) };
      });
      output.repos = buildReposArray(items, ctx.config.project);
    }

    console.log(JSON.stringify(output, null, 2));
  } else if (isProject) {
    printProjectLint(result, ctx.config.project);
  } else {
    printLocalLint(result);
  }

  if (result.errors.length > 0) {
    process.exitCode = 1;
  }

  if (options?.strict && result.warnings.length > 0) {
    process.exitCode = 1;
  }
}

function printLocalLint(result: ReturnType<typeof computeLint>): void {
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

function printProjectLint(result: ReturnType<typeof computeLint>, localProject: string): void {
  const byRepo = new Map<string, { errors: LintIssue[]; warnings: LintIssue[] }>();

  for (const e of result.errors) {
    const repo = extractRepo(e.planId, localProject);
    if (!byRepo.has(repo)) byRepo.set(repo, { errors: [], warnings: [] });
    byRepo.get(repo)!.errors.push(e);
  }
  for (const w of result.warnings) {
    const repo = extractRepo(w.planId, localProject);
    if (!byRepo.has(repo)) byRepo.set(repo, { errors: [], warnings: [] });
    byRepo.get(repo)!.warnings.push(w);
  }

  const repoKeys = [...byRepo.keys()].sort((a, b) => {
    if (a === localProject) return -1;
    if (b === localProject) return 1;
    return a.localeCompare(b);
  });

  for (const repoKey of repoKeys) {
    const isLocal = repoKey === localProject;
    const label = isLocal ? `${repoKey} (local)` : repoKey;
    console.log(chalk.bold(label));

    const { errors, warnings } = byRepo.get(repoKey)!;
    for (const e of errors) {
      console.log(`  ${chalk.red('✗')} ${e.message}`);
    }
    for (const w of warnings) {
      console.log(`  ${chalk.yellow('⚠')} ${w.message}`);
    }
    console.log();
  }

  if (result.fixed.length > 0) {
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

/** Extract the repo alias from a plan ID (qualified IDs have repo:planId format). */
function extractRepo(planId: string, localProject: string): string {
  const colonIdx = planId.indexOf(':');
  if (colonIdx === -1) return localProject;
  return planId.substring(0, colonIdx);
}
