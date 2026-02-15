import { join } from 'path';
import { EventEmitter } from 'events';
import { watch as fsWatch, type FSWatcher } from 'fs';
import { loadConfig, scanPlans } from './scanner.ts';
import { buildGraph, detectCycles, transitiveDependents, computeCriticalPath, pickNext, computeChunks, newlyReady } from './graph.ts';
import { validateFrontmatter, updatePlanFile } from './frontmatter.ts';
import { filterPlans, VALID_STATUSES } from './utils.ts';
import type { GraphData, Chunk, CrossChunkEdge, ChunkResult } from './graph.ts';
import type { Plan, PlanStatus, TrellisConfig, ContractSection, PlanFrontmatter } from './types.ts';

// --- Return types ---

export interface PlanSummary {
  id: string;
  title: string;
  status: PlanStatus;
  description?: string;
  tags: string[];
  repo?: string;
  assignee?: string;
}

export interface BlockedPlanSummary extends PlanSummary {
  waitingOn: string[];
}

export interface StatusResult {
  project: string;
  total: number;
  chunks: { total: number; overBudget: number };
  byStatus: {
    ready: PlanSummary[];
    blocked: BlockedPlanSummary[];
    inProgress: PlanSummary[];
    draft: PlanSummary[];
    done: PlanSummary[];
    archived: PlanSummary[];
  };
}

export interface ReadyResult {
  plans: PlanSummary[];
  next: string | null;
}

export interface DependencyInfo {
  id: string;
  status: PlanStatus | 'not_found';
  satisfied: boolean;
}

export interface ShowResult {
  id: string;
  filePath: string;
  title: string;
  status: PlanStatus;
  blocked: boolean;
  ready: boolean;
  tags: string[];
  repo?: string;
  assignee?: string;
  description?: string;
  startedAt?: string;
  completedAt?: string;
  body: string;
  dependsOn: DependencyInfo[];
  blocks: string[];
  criticalPath: string[];
  inputs: ContractSection[] | null;
  outputs: ContractSection[] | null;
}

export interface UpdateResult {
  id: string;
  previousStatus: PlanStatus;
  newStatus: PlanStatus;
  backward: boolean;
  newlyReady: string[];
}

export interface LintIssue {
  planId: string;
  type: string;
  message: string;
}

export interface LintResult {
  ok: boolean;
  total: number;
  okCount: number;
  errors: LintIssue[];
  warnings: LintIssue[];
  contractCoverage: number;
}

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

export interface EpicResult {
  epic: string;
  total: number;
  done: number;
  inProgress: number;
  notStarted: number;
  blocked: number;
  draft: number;
  progress: number;
  plans?: PlanSummary[];
}

// --- Trellis class ---

const STATUS_ORDER: Record<string, number> = {
  draft: 0,
  not_started: 1,
  in_progress: 2,
  done: 3,
  archived: 4,
};

export class Trellis extends EventEmitter {
  readonly projectDir: string;
  readonly config: TrellisConfig;

  private _plans: Plan[] | null = null;
  private _graph: GraphData | null = null;
  private _watcher: FSWatcher | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(projectDir: string) {
    super();
    this.projectDir = projectDir;
    this.config = loadConfig(projectDir);
  }

  get isWatching(): boolean {
    return this._watcher !== null;
  }

  watch(debounceMs = 100): void {
    if (this._watcher) return;

    const plansDir = join(this.projectDir, this.config.plans_dir);
    this._watcher = fsWatch(plansDir, { recursive: true }, () => {
      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => {
        this.refresh();
        this.emit('change', this.graph());
      }, debounceMs);
    });

    this._watcher.on('error', (err) => {
      this.emit('error', err);
    });
  }

  unwatch(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
  }

  /** Force rescan from disk. Clears cached plans and graph. */
  refresh(): void {
    this._plans = null;
    this._graph = null;
  }

  /** Lazily scan and cache plans. */
  private get plans(): Plan[] {
    if (!this._plans) {
      const plansDir = join(this.projectDir, this.config.plans_dir);
      this._plans = scanPlans(plansDir);
    }
    return this._plans;
  }

  /** Lazily build and cache graph. */
  private get graphData(): GraphData {
    if (!this._graph) {
      this._graph = buildGraph(this.plans);
    }
    return this._graph;
  }

  private toSummary(p: Plan): PlanSummary {
    return {
      id: p.id,
      title: p.frontmatter.title,
      status: p.frontmatter.status,
      description: p.frontmatter.description,
      tags: p.frontmatter.tags ?? [],
      repo: p.frontmatter.repo,
      assignee: p.frontmatter.assignee,
    };
  }

  status(filters?: { tag?: string; repo?: string; showDone?: boolean; showArchived?: boolean }): StatusResult {
    const allPlans = filterPlans(this.plans, { tag: filters?.tag, repo: filters?.repo });
    const total = allPlans.length;

    let plans = allPlans;
    if (!filters?.showDone) {
      plans = plans.filter(p => p.frontmatter.status !== 'done');
    }
    if (!filters?.showArchived) {
      plans = plans.filter(p => p.frontmatter.status !== 'archived');
    }

    const graph = this.graphData;
    const chunkResult = computeChunks(this.plans, graph, {
      maxLines: this.config.chunk_max_lines,
      strategy: this.config.chunk_strategy,
    });
    const overBudget = chunkResult.chunks.filter(c => c.totalLines > chunkResult.config.maxLines).length;

    const ready = plans.filter(p => graph.ready.has(p.id)).map(p => this.toSummary(p));
    const blocked: BlockedPlanSummary[] = plans.filter(p => graph.blocked.has(p.id)).map(p => {
      const waitingOn = (p.frontmatter.depends_on ?? []).filter(d => {
        const dep = graph.plans.get(d);
        return !dep || dep.frontmatter.status !== 'done';
      });
      return { ...this.toSummary(p), waitingOn };
    });
    const inProgress = plans.filter(p => p.frontmatter.status === 'in_progress').map(p => this.toSummary(p));
    const draft = plans.filter(p => p.frontmatter.status === 'draft').map(p => this.toSummary(p));
    const done = plans.filter(p => p.frontmatter.status === 'done').map(p => this.toSummary(p));
    const archived = plans.filter(p => p.frontmatter.status === 'archived').map(p => this.toSummary(p));

    return {
      project: this.config.project,
      total,
      chunks: { total: chunkResult.chunks.length, overBudget },
      byStatus: { ready, blocked, inProgress, draft, done, archived },
    };
  }

  ready(filters?: { tag?: string; repo?: string }): ReadyResult {
    let readyPlans = this.plans.filter(p => this.graphData.ready.has(p.id));
    readyPlans = filterPlans(readyPlans, { tag: filters?.tag, repo: filters?.repo });

    const filteredIds = new Set(readyPlans.map(p => p.id));
    const next = pickNext(this.graphData, filteredIds);

    return {
      plans: readyPlans.map(p => this.toSummary(p)),
      next,
    };
  }

  show(planId: string): ShowResult | null {
    const plan = this.graphData.plans.get(planId);
    if (!plan) return null;

    const fm = plan.frontmatter;
    const directDeps = this.graphData.dependents.get(planId) ?? [];
    const transitive = transitiveDependents(planId, this.graphData);
    const critPath = computeCriticalPath(planId, this.graphData);

    return {
      id: planId,
      filePath: plan.filePath,
      title: fm.title,
      status: fm.status,
      blocked: this.graphData.blocked.has(planId),
      ready: this.graphData.ready.has(planId),
      tags: fm.tags ?? [],
      repo: fm.repo,
      assignee: fm.assignee,
      description: fm.description,
      startedAt: fm.started_at,
      completedAt: fm.completed_at,
      body: plan.body,
      dependsOn: (fm.depends_on ?? []).map(depId => {
        const dep = this.graphData.plans.get(depId);
        return {
          id: depId,
          status: (dep?.frontmatter.status ?? 'not_found') as PlanStatus | 'not_found',
          satisfied: dep ? dep.frontmatter.status === 'done' : false,
        };
      }),
      blocks: [...new Set([...directDeps, ...transitive])],
      criticalPath: critPath,
      inputs: plan.inputs?.sections ?? null,
      outputs: plan.outputs?.sections ?? null,
    };
  }

  update(planId: string, status: PlanStatus): UpdateResult {
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const plan = this.graphData.plans.get(planId);
    if (!plan) {
      throw new Error(`Plan "${planId}" not found.`);
    }

    const previousStatus = plan.frontmatter.status;
    const oldOrder = STATUS_ORDER[previousStatus] ?? 0;
    const newOrder = STATUS_ORDER[status] ?? 0;
    const backward = newOrder < oldOrder;

    const updates: Partial<PlanFrontmatter> = { status };
    const deleteFields: string[] = [];

    if (status === 'in_progress' && !plan.frontmatter.started_at) {
      updates.started_at = new Date().toISOString();
    }
    if (status === 'done' && !plan.frontmatter.completed_at) {
      updates.completed_at = new Date().toISOString();
    }
    if (backward) {
      if (newOrder < STATUS_ORDER.in_progress && plan.frontmatter.started_at) {
        deleteFields.push('started_at');
      }
      if (newOrder < STATUS_ORDER.done && plan.frontmatter.completed_at) {
        deleteFields.push('completed_at');
      }
    }

    updatePlanFile(plan.filePath, updates, deleteFields.length > 0 ? deleteFields : undefined);

    const ready = newlyReady(planId, status, this.graphData);

    // Invalidate cache since we modified a file
    this.refresh();

    return {
      id: planId,
      previousStatus,
      newStatus: status,
      backward,
      newlyReady: ready,
    };
  }

  lint(options?: { strict?: boolean }): LintResult {
    const plans = this.plans;
    const graph = this.graphData;
    const planIds = new Set(plans.map(p => p.id));
    const plansWithErrors = new Set<string>();
    const errors: LintIssue[] = [];
    const warnings: LintIssue[] = [];

    // Cycles
    for (const cycle of detectCycles(plans)) {
      errors.push({ planId: cycle.path[0], type: 'cycle', message: `Cycle detected: ${cycle.path.join(' → ')}` });
      for (let i = 0; i < cycle.path.length - 1; i++) plansWithErrors.add(cycle.path[i]);
    }

    // Missing deps
    for (const plan of plans) {
      for (const dep of plan.frontmatter.depends_on ?? []) {
        if (!planIds.has(dep)) {
          errors.push({ planId: plan.id, type: 'missing_dependency', message: `Unknown dependency: ${plan.id} depends on "${dep}"` });
          plansWithErrors.add(plan.id);
        }
      }
    }

    // Frontmatter validation
    for (const plan of plans) {
      for (const e of validateFrontmatter(plan.id, plan.frontmatter)) {
        errors.push({ planId: plan.id, type: 'frontmatter', message: `${plan.id}: ${e.message}` });
        plansWithErrors.add(plan.id);
      }
    }

    // Inconsistencies: done plans with incomplete deps
    for (const plan of plans) {
      if (plan.frontmatter.status === 'done') {
        for (const dep of plan.frontmatter.depends_on ?? []) {
          const depPlan = plans.find(p => p.id === dep);
          if (depPlan && depPlan.frontmatter.status !== 'done') {
            errors.push({ planId: plan.id, type: 'inconsistency', message: `${plan.id} is done but depends on ${dep} (${depPlan.frontmatter.status})` });
            plansWithErrors.add(plan.id);
          }
        }
      }
    }

    // Warnings: in_progress with incomplete deps
    for (const plan of plans) {
      if (plan.frontmatter.status === 'in_progress') {
        for (const dep of plan.frontmatter.depends_on ?? []) {
          const depPlan = plans.find(p => p.id === dep);
          if (depPlan && depPlan.frontmatter.status !== 'done') {
            warnings.push({ planId: plan.id, type: 'incomplete_deps', message: `${plan.id} is in_progress but depends on ${dep} (${depPlan.frontmatter.status})` });
          }
        }
      }
    }

    // Orphans
    const dependedOn = new Set<string>();
    for (const plan of plans) {
      for (const dep of plan.frontmatter.depends_on ?? []) dependedOn.add(dep);
    }
    for (const plan of plans) {
      if (plan.frontmatter.status === 'draft' && !dependedOn.has(plan.id)) {
        warnings.push({ planId: plan.id, type: 'orphan', message: `Orphaned plan: ${plan.id} has no dependents and status is draft` });
      }
    }

    // Contract checks
    const planMap = new Map(plans.map(p => [p.id, p]));
    for (const plan of plans) {
      if ((graph.dependents.get(plan.id) ?? []).length > 0 && !plan.outputs) {
        warnings.push({ planId: plan.id, type: 'missing_outputs', message: `${plan.id} has dependents but no outputs.md` });
      }
      if (plan.inputs) {
        for (const refId of plan.inputs.fromPlans) {
          if (!(plan.frontmatter.depends_on ?? []).includes(refId)) {
            errors.push({ planId: plan.id, type: 'orphaned_input_ref', message: `${plan.id} inputs.md references "${refId}" not in depends_on` });
            plansWithErrors.add(plan.id);
          }
          const upstream = planMap.get(refId);
          if (upstream && !upstream.outputs) {
            warnings.push({ planId: plan.id, type: 'missing_upstream_outputs', message: `${plan.id} inputs.md references ${refId} which has no outputs.md` });
          }
        }
      }
    }

    // Coverage
    const withDependents = plans.filter(p => (graph.dependents.get(p.id) ?? []).length > 0);
    const withOutputs = withDependents.filter(p => !!p.outputs);
    const coverage = withDependents.length > 0 ? Math.round((withOutputs.length / withDependents.length) * 100) : 100;

    const ok = errors.length === 0 && (options?.strict ? warnings.length === 0 : true);

    return {
      ok,
      total: plans.length,
      okCount: plans.length - plansWithErrors.size,
      errors,
      warnings,
      contractCoverage: coverage,
    };
  }

  graph(): GraphResult {
    const plans = this.plans;
    const graph = this.graphData;
    const chunkResult = computeChunks(plans, graph, {
      maxLines: this.config.chunk_max_lines,
      strategy: this.config.chunk_strategy,
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
      project: this.config.project,
      nodes,
      edges,
      chunks: chunkResult.chunks,
      crossChunkEdges: chunkResult.crossChunkEdges,
    };
  }

  epic(name?: string): EpicResult[] {
    const plans = this.plans;
    const graph = this.graphData;
    const epicMap = new Map<string, Plan[]>();

    for (const plan of plans) {
      for (const tag of plan.frontmatter.tags ?? []) {
        if (tag.startsWith('epic:')) {
          const epicName = tag.slice(5);
          if (!epicMap.has(epicName)) epicMap.set(epicName, []);
          epicMap.get(epicName)!.push(plan);
        }
      }
    }

    if (name) {
      const epicPlans = epicMap.get(name);
      if (!epicPlans) return [];
      return [this.buildEpicResult(name, epicPlans, graph, true)];
    }

    return [...epicMap.entries()]
      .map(([epicName, epicPlans]) => this.buildEpicResult(epicName, epicPlans, graph, false))
      .sort((a, b) => a.epic.localeCompare(b.epic));
  }

  private buildEpicResult(name: string, epicPlans: Plan[], graph: GraphData, includePlans: boolean): EpicResult {
    const total = epicPlans.length;
    const done = epicPlans.filter(p => p.frontmatter.status === 'done').length;
    const result: EpicResult = {
      epic: name,
      total,
      done,
      inProgress: epicPlans.filter(p => p.frontmatter.status === 'in_progress').length,
      notStarted: epicPlans.filter(p => p.frontmatter.status === 'not_started').length,
      blocked: epicPlans.filter(p => graph.blocked.has(p.id)).length,
      draft: epicPlans.filter(p => p.frontmatter.status === 'draft').length,
      progress: total > 0 ? done / total : 0,
    };
    if (includePlans) {
      result.plans = epicPlans.map(p => this.toSummary(p));
    }
    return result;
  }

  chunks(filters?: { tag?: string; repo?: string; strategy?: 'directory' | 'topological' }): ChunkResult {
    let plans = this.plans;
    if (filters?.tag || filters?.repo) {
      plans = filterPlans(plans, { tag: filters.tag, repo: filters.repo });
    }
    const strategy = filters?.strategy ?? this.config.chunk_strategy;
    return computeChunks(plans, this.graphData, { maxLines: this.config.chunk_max_lines, strategy });
  }
}
