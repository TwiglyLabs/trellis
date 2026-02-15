import chalk from 'chalk';
import { join } from 'path';
import { loadConfig, scanPlans } from '../scanner.ts';
import { buildGraph, detectCycles } from '../graph.ts';
import { validateFrontmatter } from '../frontmatter.ts';

interface LintResult {
  plan_id: string;
  type: string;
  message: string;
}

export function lintCommand(options?: { strict?: boolean; json?: boolean }): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);

  if (plans.length === 0) {
    if (options?.json) {
      console.log(JSON.stringify({ ok: true, total: 0, errors: [], warnings: [] }, null, 2));
    } else {
      console.log('No plans found.');
    }
    return;
  }

  const planIds = new Set(plans.map(p => p.id));
  const plansWithErrors = new Set<string>();
  const errors: LintResult[] = [];
  const warnings: LintResult[] = [];

  // Cycle detection
  const cycles = detectCycles(plans);
  for (const cycle of cycles) {
    errors.push({ plan_id: cycle.path[0], type: 'cycle', message: `Cycle detected: ${cycle.path.join(' → ')}` });
    for (let i = 0; i < cycle.path.length - 1; i++) {
      plansWithErrors.add(cycle.path[i]);
    }
  }

  // Missing dependencies
  for (const plan of plans) {
    for (const dep of plan.frontmatter.depends_on ?? []) {
      if (!planIds.has(dep)) {
        errors.push({ plan_id: plan.id, type: 'missing_dependency', message: `Unknown dependency: ${plan.id} depends on "${dep}"` });
        plansWithErrors.add(plan.id);
      }
    }
  }

  // Frontmatter validation
  for (const plan of plans) {
    const fmErrors = validateFrontmatter(plan.id, plan.frontmatter);
    for (const error of fmErrors) {
      errors.push({ plan_id: plan.id, type: 'frontmatter', message: `${plan.id}: ${error.message}` });
      plansWithErrors.add(plan.id);
    }
  }

  // Inconsistencies: done plans with incomplete deps
  for (const plan of plans) {
    if (plan.frontmatter.status === 'done') {
      for (const dep of plan.frontmatter.depends_on ?? []) {
        const depPlan = plans.find(p => p.id === dep);
        if (depPlan && depPlan.frontmatter.status !== 'done') {
          errors.push({ plan_id: plan.id, type: 'inconsistency', message: `${plan.id} is done but depends on ${dep} (${depPlan.frontmatter.status})` });
          plansWithErrors.add(plan.id);
        }
      }
    }
  }

  // Warning: in_progress with incomplete deps
  for (const plan of plans) {
    if (plan.frontmatter.status === 'in_progress') {
      for (const dep of plan.frontmatter.depends_on ?? []) {
        const depPlan = plans.find(p => p.id === dep);
        if (depPlan && depPlan.frontmatter.status !== 'done') {
          warnings.push({ plan_id: plan.id, type: 'incomplete_deps', message: `${plan.id} is in_progress but depends on ${dep} (${depPlan.frontmatter.status})` });
        }
      }
    }
  }

  // Orphan detection: draft plans with no dependents
  const dependedOn = new Set<string>();
  for (const plan of plans) {
    for (const dep of plan.frontmatter.depends_on ?? []) {
      dependedOn.add(dep);
    }
  }
  for (const plan of plans) {
    if (plan.frontmatter.status === 'draft' && !dependedOn.has(plan.id)) {
      warnings.push({ plan_id: plan.id, type: 'orphan', message: `Orphaned plan: ${plan.id} has no dependents and status is draft` });
    }
  }

  // Contract checks
  const graph = buildGraph(plans);
  const planMap = new Map(plans.map(p => [p.id, p]));

  for (const plan of plans) {
    // Warning: plan has dependents but no outputs.md
    const hasDependents = (graph.dependents.get(plan.id) ?? []).length > 0;
    if (hasDependents && !plan.outputs) {
      warnings.push({ plan_id: plan.id, type: 'missing_outputs', message: `${plan.id} has dependents but no outputs.md` });
    }

    // Check inputs.md references
    if (plan.inputs) {
      for (const refId of plan.inputs.fromPlans) {
        // Error: inputs.md "From plans" references plan ID not in depends_on
        const deps = plan.frontmatter.depends_on ?? [];
        if (!deps.includes(refId)) {
          errors.push({ plan_id: plan.id, type: 'orphaned_input_ref', message: `${plan.id} inputs.md references "${refId}" not in depends_on` });
          plansWithErrors.add(plan.id);
        }

        // Warning: inputs.md references plan with no outputs.md
        const upstream = planMap.get(refId);
        if (upstream && !upstream.outputs) {
          warnings.push({ plan_id: plan.id, type: 'missing_upstream_outputs', message: `${plan.id} inputs.md references ${refId} which has no outputs.md` });
        }
      }
    }
  }

  // Contract coverage: percentage of plans with dependents that have outputs.md
  const plansWithDependents = plans.filter(p => (graph.dependents.get(p.id) ?? []).length > 0);
  const plansWithOutputs = plansWithDependents.filter(p => !!p.outputs);
  const coveragePercent = plansWithDependents.length > 0
    ? Math.round((plansWithOutputs.length / plansWithDependents.length) * 100)
    : 100;

  if (options?.json) {
    console.log(JSON.stringify({
      ok: errors.length === 0 && (options?.strict ? warnings.length === 0 : true),
      total: plans.length,
      ok_count: plans.length - plansWithErrors.size,
      errors,
      warnings,
      contract_coverage: coveragePercent,
    }, null, 2));
  } else {
    for (const e of errors) {
      console.log(`${chalk.red('✗')} ${e.message}`);
    }
    for (const w of warnings) {
      console.log(`${chalk.yellow('⚠')} ${w.message}`);
    }

    const okCount = plans.length - plansWithErrors.size;
    if (errors.length === 0 && warnings.length === 0) {
      console.log(`${chalk.green('✓')} ${plans.length} plans OK`);
    } else {
      console.log(`${chalk.green('✓')} ${okCount} of ${plans.length} plans OK`);
    }
    console.log(`Contract coverage: ${coveragePercent}% (${plansWithOutputs.length}/${plansWithDependents.length} plans with dependents have outputs.md)`);
  }

  if (errors.length > 0) {
    process.exitCode = 1;
  }

  if (options?.strict && warnings.length > 0) {
    process.exitCode = 1;
  }
}
