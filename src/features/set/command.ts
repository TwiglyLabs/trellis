import chalk from 'chalk';
import type { Command } from 'commander';
import { createContext } from '../../core/index.ts';
import { computeSet } from './logic.ts';

export function register(program: Command): void {
  program
    .command('set <plan-id> <field> [values...]')
    .description('Update frontmatter fields')
    .option('--add', 'Append to list field')
    .option('--remove', 'Remove from list field')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExamples:\n  $ trellis set my-plan description "Updated desc"\n  $ trellis set my-plan tags new-tag --add\n  $ trellis set my-plan tags old-tag --remove')
    .action((planId, field, values, options) => setCommand(planId, field, values, options));
}

interface SetOptions {
  add?: boolean;
  remove?: boolean;
  json?: boolean;
}

export function setCommand(planId: string, field: string, values: string[], options: SetOptions): void {
  const ctx = createContext(process.cwd());

  const mode = options.add ? 'add' : options.remove ? 'remove' : 'replace';
  const value = values.length === 1 ? values[0] : values;

  try {
    const result = computeSet(
      { planId, field, value, mode, graph: ctx.graph },
      { refresh: () => {} },
    );

    if (options.json) {
      console.log(JSON.stringify({
        id: result.id,
        field: result.field,
        value: result.value,
        previous_value: result.previousValue,
      }, null, 2));
      return;
    }

    const display = Array.isArray(result.value) ? result.value.join(', ') : result.value;
    console.log(`${chalk.green('✓')} ${planId}.${field} = ${display}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.error(JSON.stringify({ error: message }));
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  }
}
