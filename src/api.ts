import { join } from 'path';
import { EventEmitter } from 'events';
import { watch as fsWatch, type FSWatcher } from 'fs';
import {
  loadConfig, scanPlans,
  buildGraph, computeChunks,
  discoverManifest, fetchProjectPlans,
} from './core/index.ts';
import { computeStatus } from './features/status/logic.ts';
import { computeReady } from './features/ready/logic.ts';
import { computeShow } from './features/show/logic.ts';
import { computeUpdate } from './features/update/logic.ts';
import { computeLint } from './features/lint/logic.ts';
import { computeCreate } from './features/create/logic.ts';
import { computeSet } from './features/set/logic.ts';
import { computeRename } from './features/rename/logic.ts';
import { computeArchive } from './features/archive/logic.ts';
import { computeWriteSection, computeReadSection } from './features/sections/logic.ts';
import { computeEpic } from './features/epic/logic.ts';
import { computeChunksFeature } from './features/chunks/logic.ts';
import { computeMetrics } from './features/metrics/logic.ts';
import type { GraphData, Chunk, CrossChunkEdge, ChunkResult } from './core/graph.ts';
import type { Plan, PlanStatus, TrellisConfig, ContractSection } from './core/types.ts';
import type { GitExecutor } from './core/manifest.ts';

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
  structural: { errors: LintIssue[]; warnings: LintIssue[] };
  fixed: string[];
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

export interface CreateResult {
  id: string;
  filePath: string;
}

export interface SetResult {
  id: string;
  field: string;
  value: string | string[];
  previousValue: string | string[] | undefined;
}

export interface WriteSectionResult {
  id: string;
  file: string;
  section: string;
  content: string;
}

export interface ReadSectionResult {
  id: string;
  file?: string;
  section?: string;
  content: string;
}

export interface RenameResult {
  oldId: string;
  newId: string;
  referencesUpdated: string[];
}

export interface ArchiveResult {
  id: string;
  previousStatus: PlanStatus;
  newStatus: 'archived';
}

export interface RepoFetchStatus {
  alias: string;
  ok: boolean;
  planCount: number;
  error?: string;
}

export interface FetchResult {
  project: string;
  repos: RepoFetchStatus[];
  totalPlans: number;
}

export interface PlanMetric {
  id: string;
  title: string;
  completed_at: string;
  cycle_time_hours: number | null;
  queue_time_hours: number | null;
  lines: number;
  tags: string[];
  epic: string | null;
  sessions: number | null;
  deviation: string | null;
}

export interface MetricsResult {
  plans: PlanMetric[];
  total_completed: number;
  median_cycle_time_hours: number | null;
  plans_per_epic: Record<string, number>;
}

export type CreateOptions = {
  title: string;
  description?: string;
  depends_on?: string[];
  tags?: string[];
};

// --- Trellis class ---

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
    return computeStatus({
      plans: this.plans,
      config: this.config,
      graph: this.graphData,
      filters,
      toSummary: p => this.toSummary(p),
    });
  }

  ready(filters?: { tag?: string; repo?: string }): ReadyResult {
    return computeReady({
      plans: this.plans,
      graph: this.graphData,
      filters,
      toSummary: p => this.toSummary(p),
    });
  }

  show(planId: string): ShowResult | null {
    return computeShow({ planId, graph: this.graphData });
  }

  update(planId: string, status: PlanStatus, options?: { force?: boolean }): UpdateResult {
    return computeUpdate(
      { planId, status, graph: this.graphData, force: options?.force },
      { refresh: () => this.refresh() },
    );
  }

  lint(options?: { strict?: boolean; fix?: boolean }): LintResult {
    return computeLint({
      plans: this.plans,
      graph: this.graphData,
      projectDir: this.projectDir,
      plansDir: join(this.projectDir, this.config.plans_dir),
      options,
    });
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
    return computeEpic({
      plans: this.plans,
      graph: this.graphData,
      name,
      toSummary: p => this.toSummary(p),
    });
  }

  chunks(filters?: { tag?: string; repo?: string; strategy?: 'directory' | 'topological' }): ChunkResult {
    return computeChunksFeature({
      plans: this.plans,
      graph: this.graphData,
      config: this.config,
      filters,
    });
  }

  metrics(options?: { since?: string }): MetricsResult {
    return computeMetrics({ plans: this.plans, since: options?.since });
  }

  create(id: string, opts: CreateOptions): CreateResult {
    const plansDir = join(this.projectDir, this.config.plans_dir);
    return computeCreate(
      { id, opts, plansDir, graph: this.graphData },
      { refresh: () => this.refresh() },
    );
  }

  set(planId: string, field: string, value: string | string[], mode: 'replace' | 'add' | 'remove' = 'replace'): SetResult {
    return computeSet(
      { planId, field, value, mode, graph: this.graphData },
      { refresh: () => this.refresh() },
    );
  }

  writeSection(planId: string, file: string, section: string, content: string): WriteSectionResult {
    return computeWriteSection(
      { planId, file, section, content, graph: this.graphData },
      { refresh: () => this.refresh() },
    );
  }

  readSection(planId: string, file?: string, section?: string): ReadSectionResult {
    return computeReadSection({ planId, file, section, graph: this.graphData });
  }

  rename(oldId: string, newId: string): RenameResult {
    const plansDir = join(this.projectDir, this.config.plans_dir);
    return computeRename(
      { oldId, newId, plansDir, graph: this.graphData },
      { refresh: () => this.refresh() },
    );
  }

  fetch(git?: GitExecutor): FetchResult {
    if (!this.config.manifest) {
      throw new Error('No manifest configured. Add "manifest: <git-url>" to .trellis');
    }

    const manifest = discoverManifest(this.config.manifest, this.projectDir, git);
    if (!manifest) {
      throw new Error('Failed to discover project manifest. Check manifest URL and network access.');
    }

    const remotePlans = fetchProjectPlans(manifest, this.config.project, this.projectDir, git);
    const repos: RepoFetchStatus[] = [];
    let totalPlans = 0;

    for (const [alias, entry] of Object.entries(manifest.repos)) {
      if (alias === this.config.project) continue;
      const plans = remotePlans.get(alias);
      if (plans) {
        repos.push({ alias, ok: true, planCount: plans.length });
        totalPlans += plans.length;
      } else {
        repos.push({ alias, ok: false, planCount: 0, error: `Failed to fetch plans from "${alias}"` });
      }
    }

    return { project: manifest.name, repos, totalPlans };
  }

  projectPlans(git?: GitExecutor): Map<string, Plan[]> | null {
    if (!this.config.manifest) return null;

    const manifest = discoverManifest(this.config.manifest, this.projectDir, git);
    if (!manifest) return null;

    return fetchProjectPlans(manifest, this.config.project, this.projectDir, git);
  }

  archive(planId: string): ArchiveResult {
    return computeArchive(
      { planId, graph: this.graphData },
      { refresh: () => this.refresh() },
    );
  }
}
