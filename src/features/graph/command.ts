import { createServer } from 'http';
import { execFile } from 'child_process';
import type { Command } from 'commander';
import { createContext } from '../../core/index.ts';
import viewerHtml from './viewer/index.html';
import { getGraphData, computeGraph } from './logic.ts';

export function register(program: Command): void {
  program
    .command('graph')
    .description('Open DAG viewer in browser')
    .option('--port <port>', 'Port to serve on', parseInt)
    .option('--json', 'Output graph as JSON (nodes + edges) instead of opening browser')
    .addHelpText('after', '\nExamples:\n  $ trellis graph\n  $ trellis graph --port 8080\n  $ trellis graph --json')
    .action((options) => graphCommand(options));
}

export function graphCommand(options: { port?: number; json?: boolean }): void {
  const cwd = process.cwd();
  const ctx = createContext(cwd);
  const result = computeGraph({ plans: ctx.plans, graph: ctx.graph, config: ctx.config });

  if (options.json) {
    const nodes = result.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      status: n.status,
      blocked: n.blocked,
      ready: n.ready,
      depends_on: n.dependsOn,
      tags: n.tags,
      repo: n.repo,
      assignee: n.assignee,
    }));

    const edges = result.edges.map((e) => ({
      from: e.from,
      to: e.to,
    }));

    console.log(JSON.stringify({ nodes, edges }, null, 2));
    return;
  }

  if (result.nodes.length === 0) {
    console.log('No plans found.');
    return;
  }

  const server = createServer((req, res) => {
    if (req.url === '/api/data') {
      const freshData = getGraphData(cwd);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(freshData));
      return;
    }

    const data = getGraphData(cwd);
    const html = viewerHtml.replace(
      '__TRELLIS_DATA__',
      JSON.stringify(data),
    );
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${options.port} is already in use. Try a different port with --port <port> or omit --port to use a random port.`);
    } else {
      console.error(`Server error: ${err.message}`);
    }
    process.exitCode = 1;
  });

  const port = options.port || 0;
  server.listen(port, () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : port;
    const url = `http://localhost:${actualPort}`;
    console.log(`Serving DAG viewer at ${url}`);
    console.log('Press Ctrl+C to stop');

    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    execFile(cmd, [url], (err) => {
      if (err) console.log(`Open ${url} in your browser`);
    });
  });
}
