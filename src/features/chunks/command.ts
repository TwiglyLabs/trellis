import chalk from 'chalk';
import type { Command } from 'commander';
import { createContext, buildGraph } from '../../core/index.ts';
import type { ChunkResult } from '../../core/graph.ts';
import { pluralize, formatLines, resolveProjectPlans } from '../../core/utils.ts';
import { computeChunksFeature } from './logic.ts';

export function register(program: Command): void {
  program
    .command('chunks')
    .description('Identify reviewable subgraphs from the plan dependency graph')
    .option('--json', 'Output as JSON')
    .option('--verbose', 'Show cross-chunk edges and size details')
    .option('--tag <tag>', 'Filter by tag')
    .option('--repo <repo>', 'Filter by repo')
    .option('--strategy <strategy>', 'Chunk strategy: directory or topological')
    .option('--offline', 'Skip remote fetch, use cache or local only')
    .option('--project', 'Show plans from all repos in the project')
    .addHelpText('after', '\nExamples:\n  $ trellis chunks\n  $ trellis chunks --json\n  $ trellis chunks --verbose\n  $ trellis chunks --tag foundation\n  $ trellis chunks --repo cloud\n  $ trellis chunks --project')
    .action((options) => chunksCommand(options));
}

interface ChunksOptions {
  json?: boolean;
  verbose?: boolean;
  tag?: string;
  repo?: string;
  strategy?: 'directory' | 'topological';
  offline?: boolean;
  project?: boolean;
}

export function chunksCommand(options: ChunksOptions): void {
  const ctx = createContext(process.cwd(), { offline: options.offline });
  const { isProject } = resolveProjectPlans(ctx.plans, ctx.manifest, options.project);

  if (isProject) {
    // Compute chunks per-repo independently
    const localPlans = ctx.plans.filter(p => p.repoAlias == null);
    const byRepo = new Map<string, typeof ctx.plans>();
    byRepo.set(ctx.config.project, localPlans);

    for (const p of ctx.plans) {
      if (p.repoAlias) {
        if (!byRepo.has(p.repoAlias)) byRepo.set(p.repoAlias, []);
        byRepo.get(p.repoAlias)!.push(p);
      }
    }

    const repoResults: { alias: string; local: boolean; result: ChunkResult }[] = [];
    const repoKeys = [...byRepo.keys()].sort((a, b) => {
      if (a === ctx.config.project) return -1;
      if (b === ctx.config.project) return 1;
      return a.localeCompare(b);
    });

    for (const repoKey of repoKeys) {
      const repoPlans = byRepo.get(repoKey)!;
      if (repoPlans.length === 0) continue;
      const repoGraph = buildGraph(repoPlans);
      const result = computeChunksFeature({
        plans: repoPlans,
        graph: repoGraph,
        config: ctx.config,
        filters: { tag: options.tag, repo: options.repo, strategy: options.strategy },
      });
      repoResults.push({ alias: repoKey, local: repoKey === ctx.config.project, result });
    }

    if (options.json) {
      console.log(JSON.stringify({
        repos: repoResults.map(r => ({
          alias: r.alias,
          local: r.local,
          ...r.result,
        })),
      }, null, 2));
      return;
    }

    let hasOverBudget = false;
    for (const { alias, local, result } of repoResults) {
      if (result.chunks.length === 0) continue;
      const label = local ? `${alias} (local)` : alias;
      console.log(chalk.bold(label));
      const overrideLabel = result.config.overrides > 0
        ? `, ${pluralize(result.config.overrides, 'manual override')}`
        : '';
      console.log(`  Chunks (${result.chunks.length} discovered${overrideLabel}):\n`);

      for (const chunk of result.chunks) {
        const overBudget = chunk.totalLines > result.config.maxLines;
        if (overBudget) hasOverBudget = true;
        const sizeLabel = `${formatLines(chunk.totalLines)} lines`;
        const warning = overBudget ? chalk.yellow(' [over budget]') : '';
        console.log(`    ${chalk.bold(chunk.id)} (${pluralize(chunk.planCount, 'plan')}, ${sizeLabel})${warning}`);
        for (const plan of chunk.plans) {
          console.log(`      ${plan.id}`);
        }
        console.log();
      }

      if (options.verbose && result.crossChunkEdges.length > 0) {
        console.log(`  Cross-chunk edges: ${result.crossChunkEdges.length}`);
        for (const edge of result.crossChunkEdges) {
          console.log(`    ${edge.from} (${edge.fromChunk}) -> ${edge.to} (${edge.toChunk})`);
        }
        console.log();
      }
    }

    if (hasOverBudget) {
      process.exitCode = 1;
    }
    return;
  }

  // Non-project mode: existing behavior
  const result = computeChunksFeature({
    plans: ctx.plans,
    graph: ctx.graph,
    config: ctx.config,
    filters: {
      tag: options.tag,
      repo: options.repo,
      strategy: options.strategy,
    },
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.chunks.length === 0) {
    console.log('No plans found.');
    return;
  }

  printHumanReadable(result, options);
}

function printHumanReadable(result: ChunkResult, options: ChunksOptions): void {
  const overrideLabel = result.config.overrides > 0
    ? `, ${pluralize(result.config.overrides, 'manual override')}`
    : '';
  console.log(`Chunks (${result.chunks.length} discovered${overrideLabel}):\n`);

  let hasOverBudget = false;
  for (const chunk of result.chunks) {
    const overBudget = chunk.totalLines > result.config.maxLines;
    if (overBudget) hasOverBudget = true;
    const sizeLabel = `${formatLines(chunk.totalLines)} lines`;
    const warning = overBudget ? chalk.yellow(' [over budget]') : '';
    console.log(`  ${chalk.bold(chunk.id)} (${pluralize(chunk.planCount, 'plan')}, ${sizeLabel})${warning}`);
    for (const plan of chunk.plans) {
      console.log(`    ${plan.id}`);
    }
    console.log();

    if (overBudget) {
      console.error(`Warning: chunk "${chunk.id}" exceeds line budget (${chunk.totalLines} > ${result.config.maxLines})`);
    }
  }

  if (hasOverBudget) {
    process.exitCode = 1;
  }

  if (options.verbose && result.crossChunkEdges.length > 0) {
    console.log(`Cross-chunk edges: ${result.crossChunkEdges.length}`);
    for (const edge of result.crossChunkEdges) {
      console.log(`  ${edge.from} (${edge.fromChunk}) -> ${edge.to} (${edge.toChunk})`);
    }
  }
}
