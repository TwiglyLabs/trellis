import { Command } from 'commander';
import { register as registerInit } from './features/init/command.ts';
import { register as registerStatus } from './features/status/command.ts';
import { register as registerReady } from './features/ready/command.ts';
import { register as registerUpdate } from './features/update/command.ts';
import { register as registerShow } from './features/show/command.ts';
import { register as registerLint } from './features/lint/command.ts';
import { register as registerGraph } from './features/graph/command.ts';
import { register as registerEpic } from './features/epic/command.ts';
import { register as registerChunks } from './features/chunks/command.ts';
import { register as registerCreate } from './features/create/command.ts';
import { register as registerSet } from './features/set/command.ts';
import { register as registerRename } from './features/rename/command.ts';
import { register as registerArchive } from './features/archive/command.ts';
import { register as registerFetch } from './features/fetch/command.ts';
import { register as registerSync } from './features/sync/command.ts';
import { register as registerMetrics } from './features/metrics/command.ts';
import { register as registerRecent } from './features/recent/command.ts';
import { register as registerSetupHooks } from './features/setup-hooks/command.ts';
import { register as registerBottlenecks } from './features/bottlenecks/command.ts';
import { startMcpServer, parseReposFlag, loadProjectRepos } from './mcp.ts';

const program = new Command();

program
  .name('trellis')
  .description('Lightweight CLI for managing plans with dependencies')
  .version('0.1.0');

registerInit(program);
registerStatus(program);
registerReady(program);
registerUpdate(program);
registerShow(program);
registerLint(program);
registerGraph(program);
registerEpic(program);
registerChunks(program);
registerCreate(program);
registerSet(program);
registerRename(program);
registerArchive(program);
registerFetch(program);
registerSync(program);
registerRecent(program);
registerMetrics(program);
registerSetupHooks(program);
registerBottlenecks(program);

program
  .command('mcp')
  .description('Start MCP server on stdio (for Claude Code integration)')
  .option('--repos <repos>', 'Comma-separated alias=path pairs for multi-repo mode')
  .option('--project <dir>', 'Path to directory containing .trellis-project manifest')
  .action(async (opts: { repos?: string; project?: string }) => {
    if (opts.repos && opts.project) {
      console.error('Error: --repos and --project are mutually exclusive.');
      process.exit(1);
    }
    let repos;
    if (opts.repos) {
      repos = parseReposFlag(opts.repos);
    } else if (opts.project) {
      const result = loadProjectRepos(opts.project);
      for (const w of result.warnings) {
        console.error(`Warning: ${w}`);
      }
      repos = result.specs;
    }
    await startMcpServer(repos ? { repos } : undefined);
  });

program.parse();
