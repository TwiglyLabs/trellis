import chalk from 'chalk';
import { Trellis } from '../api.ts';

interface CreateOptions {
  title: string;
  dependsOn?: string[];
  tags?: string[];
  description?: string;
  json?: boolean;
}

export function createCommand(id: string, options: CreateOptions): void {
  const t = new Trellis(process.cwd());

  try {
    const result = t.create(id, {
      title: options.title,
      description: options.description,
      depends_on: options.dependsOn,
      tags: options.tags,
    });

    if (options.json) {
      console.log(JSON.stringify({ id: result.id, filePath: result.filePath }, null, 2));
      return;
    }

    console.log(`${chalk.green('✓')} Created plan ${id}`);
    console.log(`  ${result.filePath}`);
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
