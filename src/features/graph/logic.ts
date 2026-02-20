import { createContext, computeChunks } from '../../core/index.ts';
import type { Plan, TrellisConfig, PlanStatus } from '../../core/types.ts';
import type { TrellisContext } from '../../core/context.ts';
import type { GraphData, Chunk, CrossChunkEdge } from '../../core/graph.ts';
import { computeShow } from '../show/logic.ts';

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
  description?: string;
  body: string;
  inputs?: string;
  outputs?: string;
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
    description: p.frontmatter.description,
    body: p.body,
    inputs: p.inputs?.raw,
    outputs: p.outputs?.raw,
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

export function getGraphData(cwd: string) {
  const ctx = createContext(cwd);
  const result = computeGraph({ plans: ctx.plans, graph: ctx.graph, config: ctx.config });

  return {
    project: result.project,
    plans: result.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      status: n.status,
      blocked: n.blocked,
      ready: n.ready,
      depends_on: n.dependsOn,
      tags: n.tags,
      repo: n.repo,
      description: n.description,
      filePath: computeShow({ planId: n.id, graph: ctx.graph })?.filePath ?? '',
      body: n.body,
      outputs: n.outputs,
      inputs: n.inputs,
    })),
    chunks: result.chunks,
    crossChunkEdges: result.crossChunkEdges,
  };
}
