import chalk from 'chalk';
import { Trellis } from '../../api.ts';
import type { ChunkResult } from '../../core/graph.ts';
import { pluralize, formatLines } from '../../core/utils.ts';

interface ChunksOptions {
  json?: boolean;
  verbose?: boolean;
  tag?: string;
  repo?: string;
  strategy?: 'directory' | 'topological';
}

export function chunksCommand(options: ChunksOptions): void {
  const t = new Trellis(process.cwd());

  const result = t.chunks({
    tag: options.tag,
    repo: options.repo,
    strategy: options.strategy,
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
