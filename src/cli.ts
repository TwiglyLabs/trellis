import { Command } from 'commander';
import { initCommand } from './features/init/command.ts';
import { statusCommand } from './features/status/command.ts';
import { readyCommand } from './features/ready/command.ts';
import { updateCommand } from './features/update/command.ts';
import { showCommand } from './features/show/command.ts';
import { lintCommand } from './features/lint/command.ts';
import { graphCommand } from './features/graph/command.ts';
import { epicCommand } from './features/epic/command.ts';
import { chunksCommand } from './features/chunks/command.ts';
import { createCommand } from './features/create/command.ts';
import { setCommand } from './features/set/command.ts';
import { renameCommand } from './features/rename/command.ts';
import { archiveCommand } from './features/archive/command.ts';
import { fetchCommand } from './features/fetch/command.ts';
import { metricsCommand } from './features/metrics/command.ts';
import { setupHooksCommand } from './features/setup-hooks/command.ts';
import { startMcpServer } from './mcp.ts';

const program = new Command();

program
  .name('trellis')
  .description('Lightweight CLI for managing plans with dependencies')
  .version('0.1.0');

program
  .command('init')
  .description('Scaffold .trellis config and plans/ directory')
  .option('-y, --yes', 'Accept defaults without prompting')
  .addHelpText('after', '\nExamples:\n  $ trellis init\n  $ trellis init --yes')
  .action((options) => initCommand(options));

program
  .command('status')
  .description('Dashboard: what\'s ready, blocked, in progress')
  .option('--tag <tag>', 'Filter by tag')
  .option('--repo <repo>', 'Filter by repo')
  .option('--json', 'Output as JSON')
  .option('--all', 'Show all plans including done and archived')
  .option('--done', 'Include done plans')
  .option('--archived', 'Include archived plans')
  .addHelpText('after', '\nExamples:\n  $ trellis status\n  $ trellis status --tag foundation\n  $ trellis status --json\n  $ trellis status --all\n  $ trellis status --done')
  .action((options) => statusCommand(options));

program
  .command('ready')
  .description('List plans with all dependencies satisfied')
  .option('--tag <tag>', 'Filter by tag')
  .option('--repo <repo>', 'Filter by repo')
  .option('--json', 'Output as JSON')
  .option('--next', 'Return only the highest-priority ready plan')
  .addHelpText('after', '\nExamples:\n  $ trellis ready\n  $ trellis ready --repo public\n  $ trellis ready --json\n  $ trellis ready --next\n  $ trellis ready --next --json')
  .action((options) => readyCommand(options));

program
  .command('update <plan-id> <status>')
  .description('Edit frontmatter in-place, show what unblocks')
  .option('--json', 'Output as JSON')
  .option('--force', 'Bypass status gate validation')
  .option('-y, --yes', 'Skip retro prompts on done transition')
  .addHelpText('after', '\nExamples:\n  $ trellis update core-types in_progress\n  $ trellis update impl/parser done\n  $ trellis update core-types done --json\n  $ trellis update core-types in_progress --force')
  .action((planId, status, options) => updateCommand(planId, status, options));

program
  .command('show <plan-id>')
  .description('Show plan details and dependency chain')
  .option('--json', 'Output as JSON')
  .option('--contracts', 'Include input/output contracts')
  .option('--file <file>', 'Read specific file (readme, implementation, inputs, outputs)')
  .option('--section <section>', 'Read specific section (requires --file)')
  .option('--raw', 'Output raw plan content')
  .addHelpText('after', '\nExamples:\n  $ trellis show core-types\n  $ trellis show core-types --json\n  $ trellis show core-types --file implementation --section Steps\n  $ trellis show core-types --raw')
  .action((planId, options) => showCommand(planId, options));

program
  .command('lint')
  .description('Find cycles, missing deps, bad frontmatter, and structural issues')
  .option('--strict', 'Exit with error on warnings too')
  .option('--json', 'Output as JSON')
  .option('--fix', 'Auto-scaffold missing files and sections')
  .addHelpText('after', '\nExamples:\n  $ trellis lint\n  $ trellis lint --strict\n  $ trellis lint --json\n  $ trellis lint --fix')
  .action((options) => lintCommand(options));

program
  .command('graph')
  .description('Open DAG viewer in browser')
  .option('--port <port>', 'Port to serve on', parseInt)
  .option('--json', 'Output graph as JSON (nodes + edges) instead of opening browser')
  .addHelpText('after', '\nExamples:\n  $ trellis graph\n  $ trellis graph --port 8080\n  $ trellis graph --json')
  .action((options) => graphCommand(options));

program
  .command('epic [name]')
  .description('Show epic completion status')
  .option('--json', 'Output as JSON')
  .addHelpText('after', '\nExamples:\n  $ trellis epic\n  $ trellis epic v1\n  $ trellis epic --json')
  .action((name, options) => epicCommand(options, name));

program
  .command('chunks')
  .description('Identify reviewable subgraphs from the plan dependency graph')
  .option('--json', 'Output as JSON')
  .option('--verbose', 'Show cross-chunk edges and size details')
  .option('--tag <tag>', 'Filter by tag')
  .option('--repo <repo>', 'Filter by repo')
  .option('--strategy <strategy>', 'Chunk strategy: directory or topological')
  .addHelpText('after', '\nExamples:\n  $ trellis chunks\n  $ trellis chunks --json\n  $ trellis chunks --verbose\n  $ trellis chunks --tag foundation\n  $ trellis chunks --repo cloud')
  .action((options) => chunksCommand(options));

program
  .command('mcp')
  .description('Start MCP server on stdio (for Claude Code integration)')
  .action(async () => {
    await startMcpServer();
  });

program
  .command('create <id>')
  .description('Scaffold a new plan directory')
  .requiredOption('-t, --title <title>', 'Plan title')
  .option('--depends-on <ids...>', 'Plan IDs this depends on')
  .option('--tags <tags...>', 'Freeform tags')
  .option('-d, --description <desc>', 'One-line description')
  .option('--json', 'Output as JSON')
  .addHelpText('after', '\nExamples:\n  $ trellis create my-plan --title "My Plan"\n  $ trellis create my-plan --title "Plan" --depends-on core-types --tags foundation')
  .action((id, options) => createCommand(id, options));

program
  .command('set <plan-id> <field> [values...]')
  .description('Update frontmatter fields')
  .option('--add', 'Append to list field')
  .option('--remove', 'Remove from list field')
  .option('--json', 'Output as JSON')
  .addHelpText('after', '\nExamples:\n  $ trellis set my-plan description "Updated desc"\n  $ trellis set my-plan tags new-tag --add\n  $ trellis set my-plan tags old-tag --remove')
  .action((planId, field, values, options) => setCommand(planId, field, values, options));

program
  .command('rename <old-id> <new-id>')
  .description('Rename plan and update all references')
  .option('--json', 'Output as JSON')
  .addHelpText('after', '\nExamples:\n  $ trellis rename old-name new-name')
  .action((oldId, newId, options) => renameCommand(oldId, newId, options));

program
  .command('archive <plan-id>')
  .description('Archive a plan (set status to archived)')
  .option('--json', 'Output as JSON')
  .addHelpText('after', '\nExamples:\n  $ trellis archive completed-plan')
  .action((planId, options) => archiveCommand(planId, options));

program
  .command('fetch')
  .description('Fetch plan state from all project repos')
  .option('--json', 'Output as JSON')
  .addHelpText('after', '\nExamples:\n  $ trellis fetch\n  $ trellis fetch --json')
  .action((options) => fetchCommand(options));

program
  .command('metrics')
  .description('Show cycle time, queue time, and session data for completed plans')
  .option('--json', 'Output as JSON')
  .option('--since <date>', 'Filter to plans completed after this date')
  .addHelpText('after', '\nExamples:\n  $ trellis metrics\n  $ trellis metrics --json\n  $ trellis metrics --since 2026-02-01')
  .action((options) => metricsCommand(options));

program
  .command('setup-hooks')
  .description('Install Claude Code hooks and git pre-commit hook')
  .addHelpText('after', '\nExamples:\n  $ trellis setup-hooks')
  .action(() => setupHooksCommand());

program.parse();
