import chalk from 'chalk';
import type { Command } from 'commander';
import { createContext } from '../../core/index.ts';
import { computeCreate } from './logic.ts';

export function register(program: Command): void {
  program
    .command('create <id>')
    .description('Scaffold a new plan directory')
    .requiredOption('-t, --title <title>', 'Plan title')
    .option('--type <type>', 'Template type (feature, bugfix, refactor, investigation)')
    .option('--depends-on <ids...>', 'Plan IDs this depends on')
    .option('--tags <tags...>', 'Freeform tags')
    .option('-d, --description <desc>', 'One-line description')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExamples:\n  $ trellis create my-plan --title "My Plan"\n  $ trellis create my-plan --title "Plan" --type bugfix\n  $ trellis create my-plan --title "Plan" --depends-on core-types --tags foundation')
    .action((id, options) => createCommand(id, options));
}

interface CreateOptions {
  title: string;
  type?: string;
  dependsOn?: string[];
  tags?: string[];
  description?: string;
  json?: boolean;
}

export function createCommand(id: string, options: CreateOptions): void {
  const projectDir = process.cwd();
  const ctx = createContext(projectDir);

  // Resolve type: explicit flag > config default > undefined
  const type = options.type ?? ctx.config.default_plan_type;

  try {
    const result = computeCreate(
      {
        id,
        opts: {
          title: options.title,
          description: options.description,
          depends_on: options.dependsOn,
          tags: options.tags,
          type,
        },
        plansDir: ctx.plansDir,
        graph: ctx.graph,
        projectDir,
      },
      { refresh: () => {} },
    );

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
