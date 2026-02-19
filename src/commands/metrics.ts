import chalk from 'chalk';
import { Trellis } from '../api.ts';
import { padRight, computeColumnWidth } from '../utils.ts';

interface MetricsOptions {
  json?: boolean;
  since?: string;
}

function formatHours(h: number | null): string {
  if (h === null) return chalk.dim('—');
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h}h`;
  const days = Math.round(h / 24 * 10) / 10;
  return `${days}d`;
}

export function metricsCommand(options: MetricsOptions): void {
  const t = new Trellis(process.cwd());

  let result;
  try {
    result = t.metrics({ since: options.since });
  } catch (err: any) {
    if (options.json) {
      console.error(JSON.stringify({ error: err.message }));
    } else {
      console.error(err.message);
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.plans.length === 0) {
    console.log('No completed plans found.');
    return;
  }

  const idWidth = computeColumnWidth(result.plans.map(p => p.id));

  console.log(`\n${chalk.bold('Completed Plans')} (${result.total_completed})\n`);

  for (const p of result.plans) {
    const cycle = formatHours(p.cycle_time_hours);
    const queue = formatHours(p.queue_time_hours);
    const sess = p.sessions !== null ? `${p.sessions}s` : chalk.dim('—');
    const dev = p.deviation ?? chalk.dim('—');
    console.log(`  ${padRight(p.id, idWidth)}  cycle ${cycle}  queue ${queue}  ${p.lines} lines  ${sess}  ${dev}`);
  }

  console.log();

  // Aggregates
  if (result.median_cycle_time_hours !== null) {
    console.log(`  Median cycle time: ${formatHours(result.median_cycle_time_hours)}`);
  }

  const epicEntries = Object.entries(result.plans_per_epic);
  if (epicEntries.length > 0) {
    console.log(`  Plans per epic:`);
    for (const [epic, count] of epicEntries) {
      console.log(`    ${epic}: ${count}`);
    }
  }

  console.log();
}
