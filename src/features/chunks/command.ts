import chalk from 'chalk';
import type { Command } from 'commander';
import { createContext } from '../../core/index.ts';
import type { ChunkResult } from '../../core/graph.ts';
import { pluralize, formatLines } from '../../core/utils.ts';
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
    .addHelpText('after', '\nExamples:\n  $ trellis chunks\n  $ trellis chunks --json\n  $ trellis chunks --verbose\n  $ trellis chunks --tag foundation\n  $ trellis chunks --repo cloud')
    .action((options) => chunksCommand(options));
}

interface ChunksOptions {
  json?: boolean;
  verbose?: boolean;
  tag?: string;
  repo?: string;
  strategy?: 'directory' | 'topological';
}

export function chunksCommand(options: ChunksOptions): void {
  const ctx = createContext(process.cwd());

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
