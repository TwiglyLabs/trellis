import { computeChunks, filterPlans } from '../../core/index.ts';
import type { GraphData, ChunkResult } from '../../core/graph.ts';
import type { Plan, TrellisConfig } from '../../core/types.ts';

export interface ComputeChunksOptions {
  plans: Plan[];
  graph: GraphData;
  config: TrellisConfig;
  filters?: {
    tag?: string;
    repo?: string;
    strategy?: 'directory' | 'topological';
  };
}

export function computeChunksFeature(options: ComputeChunksOptions): ChunkResult {
  const { graph, config, filters } = options;
  let plans = options.plans;
  if (filters?.tag || filters?.repo) {
    plans = filterPlans(plans, { tag: filters.tag, repo: filters.repo });
  }
  const strategy = filters?.strategy ?? config.chunk_strategy;
  return computeChunks(plans, graph, { maxLines: config.chunk_max_lines, strategy });
}
