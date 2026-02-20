import { computeChunks } from '../../core/index.ts';
import type { Plan, TrellisConfig, PlanStatus } from '../../core/types.ts';
import type { GraphData, Chunk, CrossChunkEdge } from '../../core/graph.ts';

export interface GraphNode {
  id: string;
  title: string;
  status: PlanStatus;
  blocked: boolean;
  ready: boolean;
  dependsOn: string[];
  tags: string[];
  repo?: string;
  assignee?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphResult {
  project: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  chunks: Chunk[];
  crossChunkEdges: CrossChunkEdge[];
}

export interface ComputeGraphOptions {
  plans: Plan[];
  graph: GraphData;
  config: TrellisConfig;
}

export function computeGraph(opts: ComputeGraphOptions): GraphResult {
  const { plans, graph, config } = opts;
  const chunkResult = computeChunks(plans, graph, {
    maxLines: config.chunk_max_lines,
    strategy: config.chunk_strategy,
  });

  const nodes: GraphNode[] = plans.map(p => ({
    id: p.id,
    title: p.frontmatter.title,
    status: p.frontmatter.status,
    blocked: graph.blocked.has(p.id),
    ready: graph.ready.has(p.id),
    dependsOn: p.frontmatter.depends_on ?? [],
    tags: p.frontmatter.tags ?? [],
    repo: p.frontmatter.repo,
    assignee: p.frontmatter.assignee,
  }));

  const edges: GraphEdge[] = [];
  for (const plan of plans) {
    for (const dep of plan.frontmatter.depends_on ?? []) {
      edges.push({ from: dep, to: plan.id });
    }
  }

  return {
    project: config.project,
    nodes,
    edges,
    chunks: chunkResult.chunks,
    crossChunkEdges: chunkResult.crossChunkEdges,
  };
}

