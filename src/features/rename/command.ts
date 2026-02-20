import chalk from 'chalk';
import { Trellis } from '../../api.ts';

interface RenameOptions {
  json?: boolean;
}

export function renameCommand(oldId: string, newId: string, options?: RenameOptions): void {
  const t = new Trellis(process.cwd());

  try {
    const result = t.rename(oldId, newId);

    if (options?.json) {
      console.log(JSON.stringify({
        old_id: result.oldId,
        new_id: result.newId,
        references_updated: result.referencesUpdated,
      }, null, 2));
      return;
    }

    console.log(`${chalk.green('✓')} Renamed ${oldId} → ${newId}`);
    if (result.referencesUpdated.length > 0) {
      console.log(`  Updated depends_on in: ${result.referencesUpdated.join(', ')}`);
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
