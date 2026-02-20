import chalk from 'chalk';
import { createInterface } from 'readline';
import { Trellis } from '../api.ts';
import { padRight, computeColumnWidth } from '../core/utils.ts';
import type { PlanStatus } from '../core/types.ts';

interface UpdateOptions {
  json?: boolean;
  force?: boolean;
  yes?: boolean;
}

function prompt(question: string, defaultVal: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} [${defaultVal}]: `, answer => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

export async function updateCommand(planId: string, status: string, options?: UpdateOptions): Promise<void> {
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

    // Prompt for retro data when transitioning to done
    if (result.newStatus === 'done' && !options?.yes && !options?.json) {
      console.log(chalk.dim('\n  Quick retro (press Enter to skip):'));
      const sessionsRaw = await prompt('  Sessions', '');
      const deviationRaw = await prompt('  Deviation (none/minor/major)', '');

      if (sessionsRaw) {
        const num = Number(sessionsRaw);
        if (Number.isInteger(num) && num >= 1) {
          t.set(planId, 'sessions', String(num));
        }
      }
      if (deviationRaw && ['none', 'minor', 'major'].includes(deviationRaw)) {
        t.set(planId, 'deviation', deviationRaw);
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
