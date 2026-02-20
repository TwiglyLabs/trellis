import type { Command } from 'commander';
import { createContext, computeCriticalPath, pluralize } from '../../core/index.ts';
import { computeGraph } from './logic.ts';

export function register(program: Command): void {
  program
    .command('graph')
    .description('Show plan dependency graph')
    .option('--json', 'Output graph as JSON (nodes + edges)')
    .option('--offline', 'Skip remote fetch, use cache or local only')
    .addHelpText('after', '\nExamples:\n  $ trellis graph\n  $ trellis graph --json')
    .action((options) => graphCommand(options));
}

export function graphCommand(options: { json?: boolean; offline?: boolean }): void {
  const cwd = process.cwd();
  const ctx = createContext(cwd, { offline: options.offline });
  // Display local plans only — remote plans are in the graph for dep resolution
  const localPlans = ctx.plans.filter(p => p.repoAlias == null);
  const result = computeGraph({ plans: localPlans, graph: ctx.graph, config: ctx.config });

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

  // Text summary
  const planCount = result.nodes.length;
  const edgeCount = result.edges.length;
  console.log(`${pluralize(planCount, 'plan')}, ${pluralize(edgeCount, 'edge')}`);

  // Ready list
  const readyIds = result.nodes.filter(n => n.ready).map(n => n.id);
  if (readyIds.length > 0) {
    console.log(`Ready: ${readyIds.join(', ')}`);
  }

  // Blocked list with reasons
  const blockedNodes = result.nodes.filter(n => n.blocked);
  if (blockedNodes.length > 0) {
    const blockedParts = blockedNodes.map(n => {
      const deps = ctx.graph.dependencies.get(n.id) ?? [];
      const unsatisfied = deps.filter(depId => {
        const dep = ctx.graph.plans.get(depId);
        return dep && dep.frontmatter.status !== 'done';
      });
      return `${n.id} (by: ${unsatisfied.join(', ')})`;
    });
    console.log(`Blocked: ${blockedParts.join(', ')}`);
  }

  // Critical path: find leaf nodes (no dependents in active graph), compute longest chain
  const leafIds = result.nodes
    .filter(n => {
      const deps = ctx.graph.dependents.get(n.id) ?? [];
      return deps.length === 0;
    })
    .map(n => n.id);

  let longestPath: string[] = [];
  for (const leafId of leafIds) {
    const path = computeCriticalPath(leafId, ctx.graph);
    if (path.length > longestPath.length) {
      longestPath = path;
    }
  }

  if (longestPath.length > 1) {
    console.log(`Critical path: ${longestPath.join(' → ')} (${longestPath.length} steps)`);
  }
}
