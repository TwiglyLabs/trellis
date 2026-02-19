import chalk from 'chalk';
import { Trellis } from '../api.ts';
import { padRight, computeColumnWidth } from '../utils.ts';
import type { PlanStatus } from '../types.ts';

interface UpdateOptions {
  json?: boolean;
  force?: boolean;
}

export function updateCommand(planId: string, status: string, options?: UpdateOptions): void {
  const t = new Trellis(process.cwd());

  try {
    const result = t.update(planId, status as PlanStatus, { force: options?.force });

    if (options?.json) {
      const output = {
        id: result.id,
        previous_status: result.previousStatus,
        status: result.newStatus,
        backward: result.backward,
        newly_ready: result.newlyReady,
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    if (result.backward) {
      console.log(chalk.yellow(`⚠ Moving ${planId} backward: ${result.previousStatus} → ${result.newStatus}`));
    }

    console.log(`${chalk.green('✓')} ${planId} → ${result.newStatus}`);

    if (result.newlyReady.length > 0) {
      const idWidth = computeColumnWidth(result.newlyReady);
      console.log(`\n  Now ready:`);
      for (const id of result.newlyReady) {
        const readyPlan = t.show(id);
        if (readyPlan) {
          console.log(`    ${chalk.white(padRight(id, idWidth))} ${readyPlan.title}`);
        }
      }
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
