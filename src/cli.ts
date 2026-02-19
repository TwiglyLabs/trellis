import { Command } from 'commander';
import { initCommand } from './commands/init.ts';
import { statusCommand } from './commands/status.ts';
import { readyCommand } from './commands/ready.ts';
import { updateCommand } from './commands/update.ts';
import { showCommand } from './commands/show.ts';
import { lintCommand } from './commands/lint.ts';
import { graphCommand } from './commands/graph.ts';
import { epicCommand } from './commands/epic.ts';
import { chunksCommand } from './commands/chunks.ts';

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
  .addHelpText('after', '\nExamples:\n  $ trellis update core-types in_progress\n  $ trellis update impl/parser done\n  $ trellis update core-types done --json\n  $ trellis update core-types in_progress --force')
  .action((planId, status, options) => updateCommand(planId, status, options));

program
  .command('show <plan-id>')
  .description('Show plan details and dependency chain')
  .option('--json', 'Output as JSON')
  .option('--contracts', 'Include input/output contracts')
  .addHelpText('after', '\nExamples:\n  $ trellis show core-types\n  $ trellis show impl/parser\n  $ trellis show core-types --json\n  $ trellis show core-types --contracts\n  $ trellis show core-types --json --contracts')
  .action((planId, options) => showCommand(planId, options));

program
  .command('lint')
  .description('Find cycles, missing deps, bad frontmatter')
  .option('--strict', 'Exit with error on warnings too')
  .option('--json', 'Output as JSON')
  .addHelpText('after', '\nExamples:\n  $ trellis lint\n  $ trellis lint --strict\n  $ trellis lint --json')
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

program.parse();
