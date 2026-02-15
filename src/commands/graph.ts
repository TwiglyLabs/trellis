import { createServer } from 'http';
import { join } from 'path';
import { execFile } from 'child_process';
import { loadConfig, scanPlans } from '../scanner.ts';
import { buildGraph, computeChunks } from '../graph.ts';
import viewerHtml from '../viewer/index.html';

function getGraphData(cwd: string) {
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);
  const graph = buildGraph(plans);
  const strategy = config.chunk_strategy;
  const chunkResult = computeChunks(plans, graph, { maxLines: config.chunk_max_lines, strategy });

  return {
    project: config.project,
    plans: plans.map(p => ({
      id: p.id,
      title: p.frontmatter.title,
      status: p.frontmatter.status,
      blocked: graph.blocked.has(p.id),
      ready: graph.ready.has(p.id),
      depends_on: p.frontmatter.depends_on ?? [],
      tags: p.frontmatter.tags ?? [],
      repo: p.frontmatter.repo,
      description: p.frontmatter.description,
      filePath: p.filePath,
      body: p.body,
      outputs: p.outputs?.raw,
      inputs: p.inputs?.raw,
    })),
    chunks: chunkResult.chunks,
    crossChunkEdges: chunkResult.crossChunkEdges,
  };
}

export function graphCommand(options: { port?: number; json?: boolean }): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);

  if (options.json) {
    const graph = buildGraph(plans);
    const nodes = plans.map(p => ({
      id: p.id,
      title: p.frontmatter.title,
      status: p.frontmatter.status,
      blocked: graph.blocked.has(p.id),
      ready: graph.ready.has(p.id),
      depends_on: p.frontmatter.depends_on ?? [],
      tags: p.frontmatter.tags ?? [],
      repo: p.frontmatter.repo,
      assignee: p.frontmatter.assignee,
    }));

    const edges: { from: string; to: string }[] = [];
    for (const plan of plans) {
      for (const dep of plan.frontmatter.depends_on ?? []) {
        edges.push({ from: dep, to: plan.id });
      }
    }

    console.log(JSON.stringify({ nodes, edges }, null, 2));
    return;
  }

  if (plans.length === 0) {
    console.log('No plans found.');
    return;
  }

  const server = createServer((req, res) => {
    if (req.url === '/api/data') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getGraphData(cwd)));
      return;
    }

    // Serve HTML with injected data
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

    // Open browser
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    execFile(cmd, [url], (err) => {
      if (err) console.log(`Open ${url} in your browser`);
    });
  });
}
