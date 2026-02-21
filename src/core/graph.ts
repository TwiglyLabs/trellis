import type { Plan } from './types.ts';
import type { PlanChangeEvent } from '../features/watch/types.ts';

export interface GraphData {
  plans: Map<string, Plan>;
  dependents: Map<string, string[]>;    // plan -> plans that depend on it (reverse edges)
  dependencies: Map<string, string[]>;  // plan -> plans it depends on (forward edges)
  blocked: Set<string>;                 // plans with unsatisfied deps
  ready: Set<string>;                   // plans with all deps satisfied, status=not_started
}

export function buildGraph(plans: Plan[]): GraphData {
  const planMap = new Map<string, Plan>();
  const dependents = new Map<string, string[]>();
  const dependencies = new Map<string, string[]>();
  const blocked = new Set<string>();
  const ready = new Set<string>();

  for (const plan of plans) {
    planMap.set(plan.id, plan);
    dependents.set(plan.id, []);
  }

  // Build dependencies (forward edges) and dependents (reverse edges)
  for (const plan of plans) {
    dependencies.set(plan.id, (plan.frontmatter.depends_on ?? []).filter(d => planMap.has(d)));
    for (const dep of plan.frontmatter.depends_on ?? []) {
      const existing = dependents.get(dep);
      if (existing) {
        existing.push(plan.id);
      }
    }
  }

  // Compute blocked and ready
  for (const plan of plans) {
    if (plan.frontmatter.status !== 'not_started') continue;

    const deps = plan.frontmatter.depends_on ?? [];
    if (deps.length === 0) {
      ready.add(plan.id);
      continue;
    }

    const allDone = deps.every(depId => {
      const dep = planMap.get(depId);
      return dep && dep.frontmatter.status === 'done';
    });

    if (allDone) {
      ready.add(plan.id);
    } else {
      blocked.add(plan.id);
    }
  }

  return { plans: planMap, dependents, dependencies, blocked, ready };
}

export interface Cycle {
  path: string[];
}

export function detectCycles(plans: Plan[]): Cycle[] {
  const cycles: Cycle[] = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  for (const plan of plans) {
    color.set(plan.id, WHITE);
  }

  function dfs(u: string): void {
    color.set(u, GRAY);
    const plan = plans.find(p => p.id === u);
    if (!plan) return;

    for (const v of plan.frontmatter.depends_on ?? []) {
      if (!color.has(v)) continue; // skip missing deps

      if (color.get(v) === GRAY) {
        // Found cycle — reconstruct path
        const cyclePath: string[] = [v];
        let cur = u;
        while (cur !== v) {
          cyclePath.unshift(cur);
          cur = parent.get(cur)!;
        }
        cyclePath.push(v);
        cycles.push({ path: cyclePath });
      } else if (color.get(v) === WHITE) {
        parent.set(v, u);
        dfs(v);
      }
    }

    color.set(u, BLACK);
  }

  for (const plan of plans) {
    if (color.get(plan.id) === WHITE) {
      parent.set(plan.id, null);
      dfs(plan.id);
    }
  }

  return cycles;
}

export function topologicalSort(plans: Plan[]): string[] {
  const adjMap = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const plan of plans) {
    adjMap.set(plan.id, []);
    inDegree.set(plan.id, 0);
  }

  for (const plan of plans) {
    for (const dep of plan.frontmatter.depends_on ?? []) {
      if (!adjMap.has(dep)) continue;
      adjMap.get(dep)!.push(plan.id);
      inDegree.set(plan.id, (inDegree.get(plan.id) ?? 0) + 1);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const neighbor of adjMap.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return result;
}

export function transitiveDependents(planId: string, graph: GraphData): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function dfs(id: string): void {
    for (const dep of graph.dependents.get(id) ?? []) {
      if (!visited.has(dep)) {
        visited.add(dep);
        result.push(dep);
        dfs(dep);
      }
    }
  }

  dfs(planId);
  return result;
}

export function computeCriticalPath(planId: string, graph: GraphData, memo = new Map<string, string[]>()): string[] {
  if (memo.has(planId)) return memo.get(planId)!;

  const plan = graph.plans.get(planId);
  if (!plan) {
    memo.set(planId, []);
    return [];
  }

  const deps = plan.frontmatter.depends_on ?? [];
  if (deps.length === 0) {
    const path = [planId];
    memo.set(planId, path);
    return path;
  }

  let longestDepPath: string[] = [];
  for (const dep of deps) {
    if (!graph.plans.has(dep)) continue;
    const depPath = computeCriticalPath(dep, graph, memo);
    if (depPath.length > longestDepPath.length) {
      longestDepPath = depPath;
    }
  }

  const path = [...longestDepPath, planId];
  memo.set(planId, path);
  return path;
}

/**
 * Pick the highest-priority ready plan.
 * Heuristic: longest forward path (most downstream work depends on this).
 * Tiebreaker: topological order.
 */
export function pickNext(graph: GraphData, candidates?: Set<string>): string | null {
  const allReady = [...graph.ready];
  const readyIds = candidates ? allReady.filter(id => candidates.has(id)) : allReady;
  if (readyIds.length === 0) return null;
  if (readyIds.length === 1) return readyIds[0];

  // Compute forward depth (longest path from this node to a leaf via dependents)
  const forwardDepth = new Map<string, number>();

  function getForwardDepth(id: string): number {
    if (forwardDepth.has(id)) return forwardDepth.get(id)!;
    const deps = graph.dependents.get(id) ?? [];
    if (deps.length === 0) {
      forwardDepth.set(id, 1);
      return 1;
    }
    const maxChild = Math.max(...deps.map(d => getForwardDepth(d)));
    const depth = 1 + maxChild;
    forwardDepth.set(id, depth);
    return depth;
  }

  // Compute topo order for tiebreaking
  const plans = [...graph.plans.values()];
  const topoOrder = topologicalSort(plans);
  const topoIndex = new Map<string, number>();
  topoOrder.forEach((id, i) => topoIndex.set(id, i));

  // Sort: longest forward depth first, then earliest in topo order
  readyIds.sort((a, b) => {
    const depthDiff = getForwardDepth(b) - getForwardDepth(a);
    if (depthDiff !== 0) return depthDiff;
    return (topoIndex.get(a) ?? 0) - (topoIndex.get(b) ?? 0);
  });

  return readyIds[0];
}

// --- Chunk types and algorithm ---

export interface ChunkPlan { id: string; filePath: string; lines: number }
export interface ChunkEdge { from: string; to: string }
export interface CrossChunkEdge extends ChunkEdge { fromChunk: string; toChunk: string }
export interface ChunkBoundaryItem {
  planId: string;
  heading: string;
  consumedBy: string[];
}

export interface Chunk {
  id: string;
  plans: ChunkPlan[];
  roots: string[];
  leaves: string[];
  planCount: number;
  totalLines: number;
  internalEdges: ChunkEdge[];
  chunkInputs?: ChunkBoundaryItem[];
  chunkOutputs?: ChunkBoundaryItem[];
  advisory?: string;
}
export interface ChunkResult {
  chunks: Chunk[];
  crossChunkEdges: CrossChunkEdge[];
  config: { maxLines: number; overrides: number }
}

const DEFAULT_MAX_LINES = 8000;

// --- Extracted chunk algorithm functions ---

function groupLines(ids: Set<string>, planMap: Map<string, Plan>): number {
  let total = 0;
  for (const id of ids) {
    const p = planMap.get(id);
    if (p) total += p.lineCount;
  }
  return total;
}

function crossEdgeCount(a: Set<string>, b: Set<string>, graph: GraphData): number {
  let count = 0;
  for (const id of a) {
    for (const dep of graph.dependencies.get(id) ?? []) {
      if (b.has(dep)) count++;
    }
    for (const dependent of graph.dependents.get(id) ?? []) {
      if (b.has(dependent)) count++;
    }
  }
  return count;
}

export function groupByDirectory(plans: Plan[]): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>();
  for (const plan of plans) {
    const slash = plan.id.indexOf('/');
    const groupKey = slash === -1 ? `__root__${plan.id}` : plan.id.substring(0, slash);
    if (!groups.has(groupKey)) groups.set(groupKey, new Set());
    groups.get(groupKey)!.add(plan.id);
  }
  return groups;
}

export function agglomerativeMerge(groups: Map<string, Set<string>>, graph: GraphData, maxLines: number): void {
  const planMap = graph.plans;
  let groupKeys = [...groups.keys()];
  let merged = true;
  while (merged) {
    merged = false;
    let bestPair: [string, string] | null = null;
    let bestEdges = 1;

    for (let i = 0; i < groupKeys.length; i++) {
      for (let j = i + 1; j < groupKeys.length; j++) {
        const a = groups.get(groupKeys[i])!;
        const b = groups.get(groupKeys[j])!;
        const edges = crossEdgeCount(a, b, graph);
        if (edges > bestEdges) {
          const combinedLines = groupLines(a, planMap) + groupLines(b, planMap);
          if (combinedLines <= maxLines) {
            bestEdges = edges;
            bestPair = [groupKeys[i], groupKeys[j]];
          }
        }
      }
    }

    if (bestPair) {
      const [keyA, keyB] = bestPair;
      const setA = groups.get(keyA)!;
      const setB = groups.get(keyB)!;
      for (const id of setB) setA.add(id);
      groups.delete(keyB);
      groupKeys = [...groups.keys()];
      merged = true;
    }
  }
}

export function applyOverrides(groups: Map<string, Set<string>>, plans: Plan[]): { overrideNames: Set<string>; overrides: number } {
  let overrides = 0;
  const overrideChunks = new Map<string, Set<string>>();

  for (const plan of plans) {
    const chunkTags = (plan.frontmatter.tags ?? []).filter(t => t.startsWith('chunk:'));
    if (chunkTags.length === 0) continue;
    const chunkName = chunkTags[0].slice(6);
    overrides++;
    for (const [, groupSet] of groups) {
      groupSet.delete(plan.id);
    }
    if (!overrideChunks.has(chunkName)) overrideChunks.set(chunkName, new Set());
    overrideChunks.get(chunkName)!.add(plan.id);
  }

  for (const [name, ids] of overrideChunks) {
    if (groups.has(name)) {
      for (const id of ids) groups.get(name)!.add(id);
    } else {
      groups.set(name, ids);
    }
  }

  return { overrideNames: new Set(overrideChunks.keys()), overrides };
}

export function assignOrphans(groups: Map<string, Set<string>>, plans: Plan[], graph: GraphData): void {
  for (const [key, ids] of groups) {
    if (ids.size === 0) groups.delete(key);
  }

  const assignedPlans = new Set<string>();
  for (const [, ids] of groups) {
    for (const id of ids) assignedPlans.add(id);
  }
  const orphans: string[] = [];
  for (const plan of plans) {
    if (!assignedPlans.has(plan.id)) orphans.push(plan.id);
  }

  for (const orphanId of orphans) {
    let bestKey: string | null = null;
    let bestSharedEdges = -1;
    let bestSize = Infinity;

    for (const [key, ids] of groups) {
      let shared = 0;
      for (const dep of graph.dependencies.get(orphanId) ?? []) {
        if (ids.has(dep)) shared++;
      }
      for (const dependent of graph.dependents.get(orphanId) ?? []) {
        if (ids.has(dependent)) shared++;
      }
      if (shared > bestSharedEdges || (shared === bestSharedEdges && ids.size < bestSize)) {
        bestSharedEdges = shared;
        bestKey = key;
        bestSize = ids.size;
      }
    }

    if (bestKey) {
      groups.get(bestKey)!.add(orphanId);
    } else if (groups.size > 0) {
      let smallestKey = [...groups.keys()][0];
      let smallestSize = groups.get(smallestKey)!.size;
      for (const [key, ids] of groups) {
        if (ids.size < smallestSize) {
          smallestKey = key;
          smallestSize = ids.size;
        }
      }
      groups.get(smallestKey)!.add(orphanId);
    }
  }
}

export function buildChunkObjects(
  groups: Map<string, Set<string>>,
  plans: Plan[],
  graph: GraphData,
  overrideNames: Set<string>,
): { chunks: Chunk[]; crossChunkEdges: CrossChunkEdge[] } {
  const planMap = graph.plans;
  const usedIds = new Set<string>();
  let seqCounter = 1;
  const chunks: Chunk[] = [];

  for (const [groupKey, planIds] of groups) {
    if (planIds.size === 0) continue;

    let chunkId: string;
    if (overrideNames.has(groupKey)) {
      chunkId = groupKey;
    } else {
      const segments = new Set<string>();
      for (const id of planIds) {
        const slash = id.indexOf('/');
        segments.add(slash === -1 ? id : id.substring(0, slash));
      }
      if (segments.size === 1) {
        chunkId = [...segments][0];
      } else {
        chunkId = `chunk-${seqCounter++}`;
      }
    }

    let finalId = chunkId;
    let suffix = 2;
    while (usedIds.has(finalId)) {
      finalId = `${chunkId}-${suffix++}`;
    }
    usedIds.add(finalId);

    const chunkPlans: ChunkPlan[] = [];
    for (const id of planIds) {
      const p = planMap.get(id);
      if (p) chunkPlans.push({ id: p.id, filePath: p.filePath, lines: p.lineCount });
    }
    chunkPlans.sort((a, b) => a.id.localeCompare(b.id));

    const internalEdges: ChunkEdge[] = [];
    for (const id of planIds) {
      for (const dep of graph.dependencies.get(id) ?? []) {
        if (planIds.has(dep)) {
          internalEdges.push({ from: dep, to: id });
        }
      }
    }

    const roots: string[] = [];
    const leaves: string[] = [];
    for (const id of planIds) {
      const deps = graph.dependencies.get(id) ?? [];
      const hasInternalDep = deps.some(d => planIds.has(d));
      if (!hasInternalDep) roots.push(id);

      const depnts = graph.dependents.get(id) ?? [];
      const hasInternalDependent = depnts.some(d => planIds.has(d));
      if (!hasInternalDependent) leaves.push(id);
    }
    roots.sort();
    leaves.sort();

    chunks.push({
      id: finalId,
      plans: chunkPlans,
      roots,
      leaves,
      planCount: chunkPlans.length,
      totalLines: chunkPlans.reduce((sum, p) => sum + p.lines, 0),
      internalEdges,
    });
  }

  chunks.sort((a, b) => a.id.localeCompare(b.id));

  const planToChunk = new Map<string, string>();
  for (const chunk of chunks) {
    for (const p of chunk.plans) {
      planToChunk.set(p.id, chunk.id);
    }
  }

  const crossChunkEdges: CrossChunkEdge[] = [];
  for (const plan of plans) {
    const dependentChunk = planToChunk.get(plan.id);
    if (!dependentChunk) continue;
    for (const dep of graph.dependencies.get(plan.id) ?? []) {
      const depChunk = planToChunk.get(dep);
      if (depChunk && depChunk !== dependentChunk) {
        crossChunkEdges.push({ from: dep, to: plan.id, fromChunk: depChunk, toChunk: dependentChunk });
      }
    }
  }

  return { chunks, crossChunkEdges };
}

// --- Topological strategy functions ---

export function computeDepths(plans: Plan[], graph: GraphData): Map<string, number> {
  const depths = new Map<string, number>();
  const planIds = new Set(plans.map(p => p.id));

  function getDepth(id: string): number {
    if (depths.has(id)) return depths.get(id)!;
    const deps = graph.dependencies.get(id) ?? [];
    if (deps.length === 0) {
      depths.set(id, 0);
      return 0;
    }
    let maxDep = 0;
    for (const dep of deps) {
      if (planIds.has(dep)) {
        maxDep = Math.max(maxDep, getDepth(dep) + 1);
      }
    }
    depths.set(id, maxDep);
    return maxDep;
  }

  for (const plan of plans) {
    getDepth(plan.id);
  }

  return depths;
}

export function groupByTopologicalDepth(plans: Plan[], graph: GraphData): Map<string, Set<string>> {
  const depths = computeDepths(plans, graph);
  const groups = new Map<string, Set<string>>();

  for (const plan of plans) {
    const depth = depths.get(plan.id) ?? 0;
    const key = `layer-${depth}`;
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key)!.add(plan.id);
  }

  return groups;
}

export function interfaceWidthSplit(
  groups: Map<string, Set<string>>,
  plans: Plan[],
  graph: GraphData,
  maxLines: number,
): Map<string, string> {
  const advisories = new Map<string, string>();
  const planMap = graph.plans;

  const toProcess = [...groups.entries()];
  for (const [groupKey, planIds] of toProcess) {
    const total = groupLines(planIds, planMap);
    if (total <= maxLines) continue;

    const depths = computeDepths(plans.filter(p => planIds.has(p.id)), graph);
    const ordered = [...planIds].sort((a, b) => {
      const da = depths.get(a) ?? 0;
      const db = depths.get(b) ?? 0;
      if (da !== db) return da - db;
      return a.localeCompare(b);
    });

    if (ordered.length < 2) {
      advisories.set(groupKey, 'chunk resists reduction — consider decomposing plans');
      continue;
    }

    let bestCut = -1;
    let bestWidth = Infinity;

    for (let cut = 1; cut < ordered.length; cut++) {
      const leftIds = new Set(ordered.slice(0, cut));
      const rightIds = new Set(ordered.slice(cut));

      const leftLines = groupLines(leftIds, planMap);
      const rightLines = groupLines(rightIds, planMap);
      if (leftLines > maxLines || rightLines > maxLines) continue;

      let width = 0;
      for (const id of leftIds) {
        const plan = planMap.get(id);
        if (plan?.outputs) {
          for (const section of plan.outputs.sections) {
            for (const depId of graph.dependents.get(id) ?? []) {
              if (rightIds.has(depId)) {
                width += section.items.length || 1;
                break;
              }
            }
          }
        } else {
          for (const depId of graph.dependents.get(id) ?? []) {
            if (rightIds.has(depId)) width++;
          }
        }
      }
      for (const id of rightIds) {
        const plan = planMap.get(id);
        if (plan?.outputs) {
          for (const section of plan.outputs.sections) {
            for (const depId of graph.dependents.get(id) ?? []) {
              if (leftIds.has(depId)) {
                width += section.items.length || 1;
                break;
              }
            }
          }
        } else {
          for (const depId of graph.dependents.get(id) ?? []) {
            if (leftIds.has(depId)) width++;
          }
        }
      }

      if (width < bestWidth) {
        bestWidth = width;
        bestCut = cut;
      }
    }

    if (bestCut === -1) {
      advisories.set(groupKey, 'chunk resists reduction — consider decomposing plans');
      continue;
    }

    const leftIds = new Set(ordered.slice(0, bestCut));
    const rightIds = new Set(ordered.slice(bestCut));

    groups.delete(groupKey);
    groups.set(`${groupKey}a`, leftIds);
    groups.set(`${groupKey}b`, rightIds);
  }

  return advisories;
}

export function chunkContractAggregation(chunks: Chunk[], plans: Plan[], graph: GraphData): void {
  const planMap = new Map(plans.map(p => [p.id, p]));
  const planToChunk = new Map<string, string>();
  for (const chunk of chunks) {
    for (const p of chunk.plans) {
      planToChunk.set(p.id, chunk.id);
    }
  }

  for (const chunk of chunks) {
    const chunkOutputs: ChunkBoundaryItem[] = [];
    const chunkInputs: ChunkBoundaryItem[] = [];
    const memberIds = new Set(chunk.plans.map(p => p.id));

    for (const cp of chunk.plans) {
      const plan = planMap.get(cp.id);
      if (!plan?.outputs) continue;

      for (const section of plan.outputs.sections) {
        const consumedBy: string[] = [];
        for (const depId of graph.dependents.get(cp.id) ?? []) {
          if (!memberIds.has(depId)) {
            consumedBy.push(depId);
          }
        }
        if (consumedBy.length > 0) {
          chunkOutputs.push({ planId: cp.id, heading: section.heading, consumedBy });
        }
      }
    }

    for (const cp of chunk.plans) {
      const plan = planMap.get(cp.id);
      if (!plan?.inputs) continue;

      for (const section of plan.inputs.sections) {
        if (section.source && !memberIds.has(section.source)) {
          chunkInputs.push({ planId: cp.id, heading: section.heading, consumedBy: [section.source] });
        }
      }
    }

    if (chunkOutputs.length > 0) chunk.chunkOutputs = chunkOutputs;
    if (chunkInputs.length > 0) chunk.chunkInputs = chunkInputs;
  }
}

export function computeChunks(plans: Plan[], graph: GraphData, options?: { maxLines?: number; strategy?: 'directory' | 'topological' }): ChunkResult {
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
  const strategy = options?.strategy ?? 'directory';

  if (plans.length === 0) {
    return { chunks: [], crossChunkEdges: [], config: { maxLines, overrides: 0 } };
  }

  const groups = strategy === 'topological'
    ? groupByTopologicalDepth(plans, graph)
    : groupByDirectory(plans);

  agglomerativeMerge(groups, graph, maxLines);

  let advisories = new Map<string, string>();
  const advisoryGroupPlans = new Map<string, Set<string>>();
  if (strategy === 'topological') {
    // Snapshot group membership before splits for advisory matching
    for (const [key, ids] of groups) {
      advisoryGroupPlans.set(key, new Set(ids));
    }
    advisories = interfaceWidthSplit(groups, plans, graph, maxLines);
  }

  const { overrideNames, overrides } = applyOverrides(groups, plans);
  assignOrphans(groups, plans, graph);
  const { chunks, crossChunkEdges } = buildChunkObjects(groups, plans, graph, overrideNames);

  // Apply advisories to chunks by matching plan membership (Fix 4: precise matching)
  for (const chunk of chunks) {
    const chunkPlanIds = new Set(chunk.plans.map(p => p.id));
    for (const [groupKey, message] of advisories) {
      const originalPlans = advisoryGroupPlans.get(groupKey);
      if (!originalPlans) continue;
      const hasOverlap = [...originalPlans].some(id => chunkPlanIds.has(id));
      if (hasOverlap) {
        chunk.advisory = message;
      }
    }
  }

  if (strategy === 'topological') {
    chunkContractAggregation(chunks, plans, graph);
  }

  return { chunks, crossChunkEdges, config: { maxLines, overrides } };
}

export function newlyReady(
  updatedPlanId: string,
  newStatus: string,
  graph: GraphData,
): string[] {
  if (newStatus !== 'done') return [];

  const result: string[] = [];
  const directDependents = graph.dependents.get(updatedPlanId) ?? [];

  for (const depId of directDependents) {
    const plan = graph.plans.get(depId);
    if (!plan || plan.frontmatter.status !== 'not_started') continue;

    const allDone = (plan.frontmatter.depends_on ?? []).every(d => {
      if (d === updatedPlanId) return true; // this one is about to be done
      const depPlan = graph.plans.get(d);
      return depPlan && depPlan.frontmatter.status === 'done';
    });

    if (allDone) {
      result.push(depId);
    }
  }

  return result;
}

// --- Incremental graph patching ---

/**
 * Recompute ready/blocked status for a single plan based on the current
 * plan map and dependency information.
 */
function recomputeStatus(
  planId: string,
  planMap: Map<string, Plan>,
  _dependencies: Map<string, string[]>,
  ready: Set<string>,
  blocked: Set<string>,
): void {
  ready.delete(planId);
  blocked.delete(planId);

  const plan = planMap.get(planId);
  if (!plan || plan.frontmatter.status !== 'not_started') return;

  const deps = plan.frontmatter.depends_on ?? [];
  if (deps.length === 0) {
    ready.add(planId);
    return;
  }

  const allDone = deps.every(depId => {
    const dep = planMap.get(depId);
    return dep && dep.frontmatter.status === 'done';
  });

  if (allDone) {
    ready.add(planId);
  } else {
    blocked.add(planId);
  }
}

/**
 * Incrementally patch a graph given a set of typed change events.
 *
 * Returns a new GraphData object (immutable update). Unchanged nodes preserve
 * referential equality. Critical path and topological ordering are NOT
 * recomputed — left for full buildGraph().
 *
 * Events are processed in order: removes first, then adds, then updates.
 * Ready/blocked is recomputed only for affected nodes and their one-hop neighbors.
 */
export function patchGraph(
  graph: GraphData,
  events: PlanChangeEvent[],
): GraphData {
  if (events.length === 0) return graph;

  // Clone graph data structures (shallow clone — node references preserved)
  const newPlans = new Map(graph.plans);
  const newDependents = new Map<string, string[]>();
  for (const [k, v] of graph.dependents) newDependents.set(k, [...v]);
  const newDependencies = new Map<string, string[]>();
  for (const [k, v] of graph.dependencies) newDependencies.set(k, [...v]);
  const newReady = new Set(graph.ready);
  const newBlocked = new Set(graph.blocked);

  // Collect all affected node IDs for final status recomputation
  const affected = new Set<string>();

  // Partition events: removes, adds, updates
  const removes: PlanChangeEvent[] = [];
  const adds: PlanChangeEvent[] = [];
  const updates: PlanChangeEvent[] = [];

  for (const event of events) {
    if (event.type === 'plan-removed') removes.push(event);
    else if (event.type === 'plan-added') adds.push(event);
    else updates.push(event);
  }

  // --- Process removes ---
  for (const event of removes) {
    if (event.type !== 'plan-removed') continue;
    const { planId } = event;

    if (!newPlans.has(planId)) continue;

    // Collect dependents before removing
    for (const depId of newDependents.get(planId) ?? []) {
      affected.add(depId);
    }
    // Remove planId from dependents lists of plans it depends on
    for (const depId of newDependencies.get(planId) ?? []) {
      const depList = newDependents.get(depId);
      if (depList) {
        newDependents.set(depId, depList.filter(d => d !== planId));
      }
    }
    // Remove planId from dependencies lists of its dependents
    for (const depId of newDependents.get(planId) ?? []) {
      const depsList = newDependencies.get(depId);
      if (depsList) {
        newDependencies.set(depId, depsList.filter(d => d !== planId));
      }
    }

    newPlans.delete(planId);
    newDependents.delete(planId);
    newDependencies.delete(planId);
    newReady.delete(planId);
    newBlocked.delete(planId);
  }

  // --- Process adds ---
  for (const event of adds) {
    if (event.type !== 'plan-added') continue;
    const { planId, plan } = event;

    newPlans.set(planId, plan);
    affected.add(planId);

    // Set up dependency edges
    const deps = (plan.frontmatter.depends_on ?? []).filter(d => newPlans.has(d));
    newDependencies.set(planId, deps);
    newDependents.set(planId, []);

    // Add this plan to the dependents list of each of its dependencies
    for (const depId of deps) {
      const existing = newDependents.get(depId);
      if (existing) {
        existing.push(planId);
      }
    }

    // Check if any existing plan has a dangling depends_on that matches this new plan
    for (const [existingId, existingPlan] of newPlans) {
      if (existingId === planId) continue;
      const existingDeps = existingPlan.frontmatter.depends_on ?? [];
      if (existingDeps.includes(planId)) {
        const fwdDeps = newDependencies.get(existingId);
        if (fwdDeps && !fwdDeps.includes(planId)) {
          fwdDeps.push(planId);
        }
        const revDeps = newDependents.get(planId);
        if (revDeps && !revDeps.includes(existingId)) {
          revDeps.push(existingId);
        }
        affected.add(existingId);
      }
    }
  }

  // --- Process updates ---
  for (const event of updates) {
    if (event.type !== 'plan-updated') continue;
    const { planId, plan } = event;

    const oldPlan = newPlans.get(planId);
    if (!oldPlan) {
      // Plan not in graph — treat as add
      newPlans.set(planId, plan);
      affected.add(planId);

      const deps = (plan.frontmatter.depends_on ?? []).filter(d => newPlans.has(d));
      newDependencies.set(planId, deps);
      newDependents.set(planId, []);

      for (const depId of deps) {
        const existing = newDependents.get(depId);
        if (existing) {
          existing.push(planId);
        }
      }

      for (const [existingId, existingPlan] of newPlans) {
        if (existingId === planId) continue;
        const existingDeps = existingPlan.frontmatter.depends_on ?? [];
        if (existingDeps.includes(planId)) {
          const fwdDeps = newDependencies.get(existingId);
          if (fwdDeps && !fwdDeps.includes(planId)) {
            fwdDeps.push(planId);
          }
          const revDeps = newDependents.get(planId);
          if (revDeps && !revDeps.includes(existingId)) {
            revDeps.push(existingId);
          }
          affected.add(existingId);
        }
      }
      continue;
    }

    // Replace node data
    newPlans.set(planId, plan);
    affected.add(planId);

    // Check if depends_on changed
    const oldDeps = oldPlan.frontmatter.depends_on ?? [];
    const newDeps = plan.frontmatter.depends_on ?? [];
    const oldDepsSet = new Set(oldDeps);
    const newDepsSet = new Set(newDeps);

    const depsChanged = oldDeps.length !== newDeps.length ||
      oldDeps.some(d => !newDepsSet.has(d)) ||
      newDeps.some(d => !oldDepsSet.has(d));

    if (depsChanged) {
      // Remove old edges
      for (const depId of oldDeps) {
        const revList = newDependents.get(depId);
        if (revList) {
          newDependents.set(depId, revList.filter(d => d !== planId));
        }
        affected.add(depId);
      }

      // Add new edges
      const resolvedNewDeps = newDeps.filter(d => newPlans.has(d));
      newDependencies.set(planId, resolvedNewDeps);
      for (const depId of resolvedNewDeps) {
        const revList = newDependents.get(depId);
        if (revList) {
          if (!revList.includes(planId)) revList.push(planId);
        }
        affected.add(depId);
      }
    }

    // Always add immediate dependents to affected set
    for (const depId of newDependents.get(planId) ?? []) {
      affected.add(depId);
    }
  }

  // --- Recompute ready/blocked for all affected nodes and their one-hop neighbors ---
  const toRecompute = new Set(affected);
  for (const id of affected) {
    for (const depId of newDependents.get(id) ?? []) {
      toRecompute.add(depId);
    }
  }

  for (const id of toRecompute) {
    if (!newPlans.has(id)) continue;
    recomputeStatus(id, newPlans, newDependencies, newReady, newBlocked);
  }

  return {
    plans: newPlans,
    dependents: newDependents,
    dependencies: newDependencies,
    ready: newReady,
    blocked: newBlocked,
  };
}
