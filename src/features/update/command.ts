import chalk from 'chalk';
import { createInterface } from 'readline';
import type { Command } from 'commander';
import { resolveCliContext, resolvePlanId, parseQualifiedId } from '../../core/index.ts';
import type { PlanStatus } from '../../core/types.ts';
import { padRight, computeColumnWidth } from '../../core/utils.ts';
import { computeUpdate } from './logic.ts';
import { computeShow } from '../show/logic.ts';
import { computeSet } from '../set/logic.ts';

export function register(program: Command): void {
  program
    .command('update <plan-id> <status>')
    .description('Edit frontmatter in-place, show what unblocks')
    .option('--json', 'Output as JSON')
    .option('--force', 'Bypass status gate validation')
    .option('-y, --yes', 'Skip retro prompts on done transition')
    .addHelpText('after', '\nExamples:\n  $ trellis update core-types in_progress\n  $ trellis update impl/parser done\n  $ trellis update core-types done --json\n  $ trellis update core-types in_progress --force\n  $ trellis update repo:core-types in_progress')
    .action((planId, status, options) => updateCommand(planId, status, options));
}

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
  let ctx = resolveCliContext(process.cwd());

  // In multi-repo mode, resolve qualified/unqualified IDs
  let resolvedId = planId;
  if (ctx.isMultiRepo) {
    const parsed = parseQualifiedId(planId);
    if (parsed.repo) {
      resolvedId = planId; // already qualified
    } else {
      const resolved = resolvePlanId(ctx.graph, planId);
      resolvedId = resolved.qualifiedId;
    }
  }

  try {
    const result = computeUpdate(
      { planId: resolvedId, status: status as PlanStatus, graph: ctx.graph, force: options?.force },
    );

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
      ctx = resolveCliContext(process.cwd());
      const idWidth = computeColumnWidth(result.newlyReady);
      console.log(`\n  Now ready:`);
      for (const id of result.newlyReady) {
        const readyPlan = computeShow({ planId: id, graph: ctx.graph });
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

      ctx = resolveCliContext(process.cwd());
      if (sessionsRaw) {
        const num = Number(sessionsRaw);
        if (Number.isInteger(num) && num >= 1) {
          computeSet(
            { planId: resolvedId, field: 'sessions', value: String(num), mode: 'replace', graph: ctx.graph },
          );
        }
      }
      if (deviationRaw && ['none', 'minor', 'major'].includes(deviationRaw)) {
        ctx = resolveCliContext(process.cwd());
        computeSet(
          { planId: resolvedId, field: 'deviation', value: deviationRaw, mode: 'replace', graph: ctx.graph },
        );
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
