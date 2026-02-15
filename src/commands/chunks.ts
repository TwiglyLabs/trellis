import chalk from 'chalk';
import { join } from 'path';
import { loadConfig, scanPlans } from '../scanner.ts';
import { buildGraph, computeChunks } from '../graph.ts';
import type { ChunkResult } from '../graph.ts';
import { pluralize, filterPlans, formatLines } from '../utils.ts';

interface ChunksOptions {
  json?: boolean;
  verbose?: boolean;
  tag?: string;
  repo?: string;
  strategy?: 'directory' | 'topological';
}

export function chunksCommand(options: ChunksOptions): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  let plans = scanPlans(plansDir);

  if (options.tag || options.repo) {
    plans = filterPlans(plans, { tag: options.tag, repo: options.repo });
  }

  if (plans.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ chunks: [], crossChunkEdges: [], config: { maxLines: config.chunk_max_lines ?? 8000, overrides: 0 } }, null, 2));
    } else {
      console.log('No plans found.');
    }
    return;
  }

  const graph = buildGraph(plans);
  const strategy = options.strategy ?? config.chunk_strategy;
  const result = computeChunks(plans, graph, { maxLines: config.chunk_max_lines, strategy });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
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
