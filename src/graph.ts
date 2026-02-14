import type { Plan } from './types.ts';

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
export interface Chunk {
  id: string;
  plans: ChunkPlan[];
  roots: string[];
  leaves: string[];
  planCount: number;
  totalLines: number;
  internalEdges: ChunkEdge[];
}
export interface ChunkResult {
  chunks: Chunk[];
  crossChunkEdges: CrossChunkEdge[];
  config: { maxLines: number; overrides: number }
}

const DEFAULT_MAX_LINES = 8000;

export function computeChunks(plans: Plan[], graph: GraphData, options?: { maxLines?: number }): ChunkResult {
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;

  if (plans.length === 0) {
    return { chunks: [], crossChunkEdges: [], config: { maxLines, overrides: 0 } };
  }

  // Step 1: Group by first path segment
  const groups = new Map<string, Set<string>>(); // groupKey -> set of plan IDs
  for (const plan of plans) {
    const slash = plan.id.indexOf('/');
    const groupKey = slash === -1 ? `__root__${plan.id}` : plan.id.substring(0, slash);
    if (!groups.has(groupKey)) groups.set(groupKey, new Set());
    groups.get(groupKey)!.add(plan.id);
  }

  // Helper: compute total lines for a set of plan IDs
  const planMap = graph.plans;
  function groupLines(ids: Set<string>): number {
    let total = 0;
    for (const id of ids) {
      const p = planMap.get(id);
      if (p) total += p.lineCount;
    }
    return total;
  }

  // Helper: count cross-edges between two groups (both directions)
  function crossEdges(a: Set<string>, b: Set<string>): number {
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

  // Step 2: Agglomerative merge
  // Complexity: O(g^2 * p) per iteration where g = groups, p = plans per group.
  // Fine for typical trellis projects (single-digit groups). May need optimization
  // if a project has 100+ top-level directories.
  let groupKeys = [...groups.keys()];
  let merged = true;
  while (merged) {
    merged = false;
    let bestPair: [string, string] | null = null;
    let bestEdges = 1; // threshold: must have >1 edge

    for (let i = 0; i < groupKeys.length; i++) {
      for (let j = i + 1; j < groupKeys.length; j++) {
        const a = groups.get(groupKeys[i])!;
        const b = groups.get(groupKeys[j])!;
        const edges = crossEdges(a, b);
        if (edges > bestEdges) {
          const combinedLines = groupLines(a) + groupLines(b);
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

  // Step 3: Manual overrides (chunk:name tags)
  let overrides = 0;
  const overrideChunks = new Map<string, Set<string>>();

  for (const plan of plans) {
    const chunkTags = (plan.frontmatter.tags ?? []).filter(t => t.startsWith('chunk:'));
    if (chunkTags.length === 0) continue;
    // Take only the first chunk: tag; ignore extras
    const chunkName = chunkTags[0].slice(6);
    overrides++;
    // Remove from current group
    for (const [, groupSet] of groups) {
      groupSet.delete(plan.id);
    }
    if (!overrideChunks.has(chunkName)) overrideChunks.set(chunkName, new Set());
    overrideChunks.get(chunkName)!.add(plan.id);
  }

  // Add override chunks to groups
  for (const [name, ids] of overrideChunks) {
    if (groups.has(name)) {
      for (const id of ids) groups.get(name)!.add(id);
    } else {
      groups.set(name, ids);
    }
  }

  // Step 4: Orphan assignment — plans in empty groups
  const emptyKeys: string[] = [];
  const orphans: string[] = [];
  for (const [key, ids] of groups) {
    if (ids.size === 0) {
      emptyKeys.push(key);
    }
  }
  // Actually, orphans are plans still in non-override groups that became empty
  // after overrides removed all their members. But we track displacement differently:
  // Remove empty groups first
  for (const key of emptyKeys) {
    groups.delete(key);
  }

  // Find plans not in any group (displaced by overrides into a chunk that then had them)
  const assignedPlans = new Set<string>();
  for (const [, ids] of groups) {
    for (const id of ids) assignedPlans.add(id);
  }
  for (const plan of plans) {
    if (!assignedPlans.has(plan.id)) orphans.push(plan.id);
  }

  // Assign orphans to the chunk with most shared edges; ties go to smaller chunk
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
      // No edges at all — put in smallest group
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

  // Build chunks from groups
  const overrideNames = new Set(overrideChunks.keys());
  const usedIds = new Set<string>();
  let seqCounter = 1;
  const chunks: Chunk[] = [];

  for (const [groupKey, planIds] of groups) {
    if (planIds.size === 0) continue;

    // Generate chunk ID
    let chunkId: string;
    if (overrideNames.has(groupKey)) {
      chunkId = groupKey;
    } else {
      // Check if all plans share a common first path segment
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

    // Handle ID collisions
    let finalId = chunkId;
    let suffix = 2;
    while (usedIds.has(finalId)) {
      finalId = `${chunkId}-${suffix++}`;
    }
    usedIds.add(finalId);

    // Build chunk plan list
    const chunkPlans: ChunkPlan[] = [];
    for (const id of planIds) {
      const p = planMap.get(id);
      if (p) chunkPlans.push({ id: p.id, filePath: p.filePath, lines: p.lineCount });
    }
    chunkPlans.sort((a, b) => a.id.localeCompare(b.id));

    // Internal edges
    const internalEdges: ChunkEdge[] = [];
    for (const id of planIds) {
      for (const dep of graph.dependencies.get(id) ?? []) {
        if (planIds.has(dep)) {
          internalEdges.push({ from: dep, to: id });
        }
      }
    }

    // Roots: no internal deps; Leaves: no internal dependents
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

  // Step 5: Cross-chunk edges
  const planToChunk = new Map<string, string>();
  for (const chunk of chunks) {
    for (const p of chunk.plans) {
      planToChunk.set(p.id, chunk.id);
    }
  }

  // Cross-chunk edges: for each plan, check if its dependencies land in a different chunk.
  // Edge direction: from = depended-on plan, to = dependent plan (matches "provides -> consumes").
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
