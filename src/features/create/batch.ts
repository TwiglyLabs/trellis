import { parseQualifiedId, dequalifyDepsForWrite } from '../../core/index.ts';
import type { ContextStore } from '../../core/store.ts';
import { computeCreate } from './logic.ts';

export interface BatchPlanSpec {
  id: string;           // qualified: repo:plan-id
  title: string;
  type?: string;
  depends_on?: string[];
  tags?: string[];
  description?: string;
}

export interface BatchResult {
  created: Array<{ id: string; filePath: string }>;
  skipped: Array<{ id: string; reason: string }>;
  errors: Array<{ id: string; error: string }>;
  wouldCreate?: Array<{ id: string }>;
}

export interface BatchCreateOptions {
  plans: BatchPlanSpec[];
  store: ContextStore;
  dryRun?: boolean;
}

/**
 * Topological sort of batch plans using Kahn's algorithm.
 * Only considers deps within the batch — external deps impose no ordering.
 * Throws on cycles.
 */
export function topologicalSort(plans: BatchPlanSpec[]): BatchPlanSpec[] {
  const ids = new Set(plans.map(p => p.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const plan of plans) {
    inDegree.set(plan.id, 0);
    adj.set(plan.id, []);
  }

  for (const plan of plans) {
    for (const dep of plan.depends_on ?? []) {
      if (ids.has(dep)) {
        adj.get(dep)!.push(plan.id);
        inDegree.set(plan.id, (inDegree.get(plan.id) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const next of adj.get(current) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  if (sorted.length !== plans.length) {
    const remaining = plans.filter(p => !sorted.includes(p.id)).map(p => p.id);
    throw new Error(`Cycle detected in batch plans: ${remaining.join(', ')}`);
  }

  const planMap = new Map(plans.map(p => [p.id, p]));
  return sorted.map(id => planMap.get(id)!);
}

/**
 * Create multiple plans in one operation with dependency validation and topological ordering.
 *
 * - Builds a "universe" of existing plan IDs + batch plan IDs for dep validation
 * - Skips plans that already exist
 * - Topo-sorts new plans so deps are created before dependents
 * - Dequalifies same-repo deps on disk, preserves cross-repo deps
 * - Invalidates the store after each create so subsequent creates see the new plan
 */
export function computeCreateBatch(options: BatchCreateOptions): BatchResult {
  const { plans, store, dryRun } = options;
  const ctx = store.get();

  // 1. Validate all plan IDs are qualified and repo aliases exist — before creating anything
  for (const plan of plans) {
    const parsed = parseQualifiedId(plan.id);
    if (!parsed.repo) {
      throw new Error(`Batch plan ID must be qualified (repo:plan-id): "${plan.id}"`);
    }
    const entry = ctx.repos.find(r => r.alias === parsed.repo);
    if (!entry) {
      throw new Error(`Repo "${parsed.repo}" not found in manifest. Add it to .trellis-project.`);
    }
    if (!entry.plansDir) {
      throw new Error(`Repo "${parsed.repo}" has no plans directory.`);
    }
  }

  // 2. Build universe: existing plan IDs + batch plan IDs
  const universe = new Set<string>(ctx.graph.plans.keys());
  for (const plan of plans) universe.add(plan.id);

  // 3. Separate existing plans (skip) from new plans
  const toCreate: BatchPlanSpec[] = [];
  const result: BatchResult = { created: [], skipped: [], errors: [] };
  if (dryRun) result.wouldCreate = [];

  for (const plan of plans) {
    if (ctx.graph.plans.has(plan.id)) {
      result.skipped.push({ id: plan.id, reason: 'already exists' });
    } else {
      toCreate.push(plan);
    }
  }

  // 4. Validate all deps exist in universe
  for (const plan of toCreate) {
    for (const dep of plan.depends_on ?? []) {
      if (!universe.has(dep)) {
        throw new Error(`Plan "${plan.id}": dependency "${dep}" not found in existing plans or batch.`);
      }
    }
  }

  // 5. Topo-sort new plans
  const sorted = topologicalSort(toCreate);

  // 6. Create in order
  for (const plan of sorted) {
    const parsed = parseQualifiedId(plan.id);

    if (dryRun) {
      result.wouldCreate!.push({ id: plan.id });
      continue;
    }

    const entry = ctx.repos.find(r => r.alias === parsed.repo!)!;
    const dequalifiedDeps = dequalifyDepsForWrite(plan.depends_on, parsed.repo!);

    try {
      const createResult = computeCreate({
        id: parsed.planId,
        opts: {
          title: plan.title,
          description: plan.description,
          depends_on: dequalifiedDeps,
          tags: plan.tags,
          type: plan.type,
        },
        plansDir: entry.plansDir!,
        graph: ctx.graph,
        projectDir: entry.path,
        skipDepValidation: true,
      });

      result.created.push({ id: plan.id, filePath: createResult.filePath });
      store.invalidate(parsed.repo!);
    } catch (error) {
      result.errors.push({
        id: plan.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
