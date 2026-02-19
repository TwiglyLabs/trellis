import chalk from 'chalk';
import { Trellis } from '../api.ts';

interface SetOptions {
  add?: boolean;
  remove?: boolean;
  json?: boolean;
}

export function setCommand(planId: string, field: string, values: string[], options: SetOptions): void {
  const t = new Trellis(process.cwd());

  const mode = options.add ? 'add' : options.remove ? 'remove' : 'replace';
  const value = values.length === 1 ? values[0] : values;

  try {
    const result = t.set(planId, field, value, mode);

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
