import chalk from 'chalk';
import { join, relative } from 'path';
import { loadConfig, scanPlans } from '../scanner.ts';
import { buildGraph, transitiveDependents, computeCriticalPath } from '../graph.ts';
import { padRight, computeColumnWidth } from '../utils.ts';

interface ShowOptions {
  json?: boolean;
}

export function showCommand(planId: string, options?: ShowOptions): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);
  const graph = buildGraph(plans);

  const plan = graph.plans.get(planId);
  if (!plan) {
    if (options?.json) {
      console.error(JSON.stringify({ error: `Plan "${planId}" not found.` }));
    } else {
      console.error(`Plan "${planId}" not found.`);
    }
    process.exitCode = 1;
    return;
  }

  const fm = plan.frontmatter;
  const isBlocked = graph.blocked.has(planId);
  const isReady = graph.ready.has(planId);
  const directDeps = graph.dependents.get(planId) ?? [];
  const transitive = transitiveDependents(planId, graph);
  const criticalPath = computeCriticalPath(planId, graph);

  if (options?.json) {
    const output = {
      id: planId,
      filePath: plan.filePath,
      title: fm.title,
      status: fm.status,
      blocked: isBlocked,
      ready: isReady,
      tags: fm.tags ?? [],
      repo: fm.repo,
      assignee: fm.assignee,
      description: fm.description,
      started_at: fm.started_at,
      completed_at: fm.completed_at,
      depends_on: (fm.depends_on ?? []).map(depId => {
        const dep = graph.plans.get(depId);
        return {
          id: depId,
          status: dep?.frontmatter.status ?? 'not_found',
          satisfied: dep ? dep.frontmatter.status === 'done' : false,
        };
      }),
      blocks: [...new Set([...directDeps, ...transitive])],
      critical_path: criticalPath,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  let statusDisplay = fm.status;
  if (isBlocked) statusDisplay += ' (blocked)';
  else if (isReady) statusDisplay += ' (ready)';

  console.log();
  console.log(`  ${chalk.bold(fm.title)}`);
  console.log(`  Path:       ${relative(cwd, plan.filePath)}`);
  console.log(`  Status:     ${statusDisplay}`);
  if (fm.tags?.length) console.log(`  Tags:       ${fm.tags.join(', ')}`);
  if (fm.repo) console.log(`  Repo:       ${fm.repo}`);
  if (fm.assignee) console.log(`  Assignee:   ${fm.assignee}`);
  if (fm.description) console.log(`  Desc:       ${fm.description}`);

  const deps = fm.depends_on ?? [];
  if (deps.length > 0) {
    const depWidth = computeColumnWidth(deps);
    console.log(`\n  Depends on:`);
    for (const depId of deps) {
      const dep = graph.plans.get(depId);
      if (!dep) {
        console.log(`    ${chalk.red('✗')} ${depId}  ${chalk.red('(not found)')}`);
      } else {
        const isDone = dep.frontmatter.status === 'done';
        const icon = isDone ? chalk.green('✓') : chalk.red('✗');
        const blocking = isDone ? '' : chalk.red('    ← blocking');
        console.log(`    ${icon} ${padRight(depId, depWidth)} ${dep.frontmatter.status}${blocking}`);
      }
    }
  }

  const transitiveOnly = transitive.filter(d => !directDeps.includes(d));

  if (directDeps.length > 0 || transitiveOnly.length > 0) {
    console.log(`\n  Blocks:`);
    for (const id of directDeps) {
      console.log(`    ${id}`);
    }
    for (const id of transitiveOnly) {
      console.log(`    ${id} ${chalk.dim('(transitive)')}`);
    }
  }

  if (criticalPath.length > 1) {
    console.log(`\n  Critical path (depth ${criticalPath.length}):`);
    console.log(`    ${criticalPath.join(' → ')}`);
  }

  console.log();
}
