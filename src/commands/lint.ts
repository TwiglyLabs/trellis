import chalk from 'chalk';
import { Trellis } from '../api.ts';

export function lintCommand(options?: { strict?: boolean; json?: boolean }): void {
  const t = new Trellis(process.cwd());
  const result = t.lint({ strict: options?.strict });

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
      contract_coverage: result.contractCoverage,
    }, null, 2));
  } else {
    for (const e of result.errors) {
      console.log(`${chalk.red('✗')} ${e.message}`);
    }
    for (const w of result.warnings) {
      console.log(`${chalk.yellow('⚠')} ${w.message}`);
    }

    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log(`${chalk.green('✓')} ${result.total} plans OK`);
    } else {
      console.log(`${chalk.green('✓')} ${result.okCount} of ${result.total} plans OK`);
    }

    const graphResult = t.graph();
    const plansWithDependents = graphResult.nodes.filter((n) => {
      return graphResult.edges.some((e) => e.from === n.id);
    });
    const plansWithOutputs = plansWithDependents.filter((n) => n.outputs !== undefined);
    console.log(`Contract coverage: ${result.contractCoverage}% (${plansWithOutputs.length}/${plansWithDependents.length} plans with dependents have outputs.md)`);
  }

  if (result.errors.length > 0) {
    process.exitCode = 1;
  }

  if (options?.strict && result.warnings.length > 0) {
    process.exitCode = 1;
  }
}
