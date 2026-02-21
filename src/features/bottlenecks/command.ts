import chalk from 'chalk';
import type { Command } from 'commander';
import { createContext } from '../../core/index.ts';
import { padRight, computeColumnWidth } from '../../core/utils.ts';
import { computeBottlenecks } from './logic.ts';

export function register(program: Command): void {
  program
    .command('bottlenecks')
    .description('Show blocking factors, stuck plans, and queue pressure')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExamples:\n  $ trellis bottlenecks\n  $ trellis bottlenecks --json')
    .action((options) => bottlenecksCommand(options));
}

interface BottlenecksOptions {
  json?: boolean;
}

export function bottlenecksCommand(options: BottlenecksOptions): void {
  const ctx = createContext(process.cwd());
  const result = computeBottlenecks({ plans: ctx.plans, graph: ctx.graph, config: ctx.config });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const hs = result.healthSummary;

  // Health summary header
  console.log(`\n${chalk.bold('Project Health')}`);
  console.log(`  ${hs.totalPlans} plans  ${chalk.green(`${hs.activePlans} active`)}  ${chalk.yellow(`${hs.blockedPlans} blocked`)}  ${chalk.cyan(`${hs.estimatedParallelism} ready`)}`);

  if (hs.stuckPlans > 0) {
    console.log(`  ${chalk.red(`${hs.stuckPlans} stuck`)}`);
  }

  // Stuck plans
  if (result.stuckPlans.length > 0) {
    console.log(`\n${chalk.bold.red('Stuck Plans')}`);
    const idWidth = computeColumnWidth(result.stuckPlans.map(p => p.id));
    for (const p of result.stuckPlans) {
      console.log(`  ${padRight(p.id, idWidth)}  ${chalk.red(`${p.daysInStatus}d`)} in_progress  ${p.title}`);
    }
  }

  // Top blockers
  if (result.highBlockingPlans.length > 0) {
    console.log(`\n${chalk.bold('Top Blockers')}`);
    const idWidth = computeColumnWidth(result.highBlockingPlans.map(p => p.id));
    for (const p of result.highBlockingPlans) {
      const statusColor = p.status === 'in_progress' ? chalk.green : p.status === 'not_started' ? chalk.yellow : chalk.dim;
      console.log(`  ${padRight(p.id, idWidth)}  blocks ${chalk.bold(String(p.blockingFactor))} plans  ${statusColor(p.status)}  ${p.title}`);
    }
  }

  // Stale plans
  if (result.stalePlans.length > 0) {
    console.log(`\n${chalk.bold.yellow('Stale Plans')}`);
    const idWidth = computeColumnWidth(result.stalePlans.map(p => p.id));
    for (const p of result.stalePlans) {
      console.log(`  ${padRight(p.id, idWidth)}  ${chalk.yellow(`${p.daysInStatus}d`)} ${p.status}  ${p.title}`);
    }
  }

  // Layer pressure
  const pressureLayers = result.layerPressure.filter(l => l.ratio > 0);
  if (pressureLayers.length > 0) {
    console.log(`\n${chalk.bold('Queue Pressure')}`);
    for (const l of pressureLayers) {
      const bar = chalk.red('|'.repeat(Math.min(Math.round(l.ratio), 20)));
      console.log(`  layer ${l.depth}  ${l.blocked} blocked / ${l.inProgress} active  ${bar} ${l.ratio}`);
    }
  }

  if (result.stuckPlans.length === 0 && result.highBlockingPlans.length === 0 && pressureLayers.length === 0) {
    console.log(`\n  ${chalk.green('No bottlenecks detected.')}`);
  }

  console.log();
}
