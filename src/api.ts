import { join, dirname } from 'path';
import { EventEmitter } from 'events';
import { watch as fsWatch, type FSWatcher, existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import matter from 'gray-matter';
import {
  loadConfig, scanPlans,
  buildGraph, computeChunks,
  parseFrontmatter, updatePlanFile,
  readSection, writeSection,
  filterPlans, validatePlanId,
  discoverManifest, fetchProjectPlans,
  PlanFile,
} from './core/index.ts';
import { computeStatus } from './features/status/logic.ts';
import { computeReady } from './features/ready/logic.ts';
import { computeShow } from './features/show/logic.ts';
import { computeUpdate } from './features/update/logic.ts';
import { computeLint } from './features/lint/logic.ts';
import { computeCreate } from './features/create/logic.ts';
import type { GraphData, Chunk, CrossChunkEdge, ChunkResult } from './core/graph.ts';
import type { Plan, PlanStatus, TrellisConfig, ContractSection, PlanFrontmatter } from './core/types.ts';
import type { GitExecutor } from './core/manifest.ts';

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

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

// Valid frontmatter field names for set()
const EDITABLE_FIELDS = ['title', 'description', 'depends_on', 'tags', 'repo', 'assignee', 'sessions', 'deviation'] as const;
const LIST_FIELDS = ['depends_on', 'tags'] as const;

// Map from short file name to PlanFile enum
const FILE_NAME_MAP: Record<string, PlanFile> = {
  readme: PlanFile.README,
  implementation: PlanFile.IMPLEMENTATION,
  inputs: PlanFile.INPUTS,
  outputs: PlanFile.OUTPUTS,
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

  metrics(options?: { since?: string }): MetricsResult {
    const donePlans = this.plans.filter(p => p.frontmatter.status === 'done');

    let filtered = donePlans;
    if (options?.since) {
      const sinceDate = new Date(options.since);
      if (isNaN(sinceDate.getTime())) {
        throw new Error(`Invalid date: "${options.since}"`);
      }
      filtered = donePlans.filter(p => {
        if (!p.frontmatter.completed_at) return false;
        return new Date(p.frontmatter.completed_at) >= sinceDate;
      });
    }

    // Sort by completion date (newest first)
    filtered.sort((a, b) => {
      const aDate = a.frontmatter.completed_at ? new Date(a.frontmatter.completed_at).getTime() : 0;
      const bDate = b.frontmatter.completed_at ? new Date(b.frontmatter.completed_at).getTime() : 0;
      return bDate - aDate;
    });

    const plans: PlanMetric[] = filtered.map(p => {
      const fm = p.frontmatter;
      const completedAt = fm.completed_at ? new Date(fm.completed_at).getTime() : null;
      const startedAt = fm.started_at ? new Date(fm.started_at).getTime() : null;
      const notStartedAt = fm.not_started_at ? new Date(fm.not_started_at).getTime() : null;

      const cycleTimeHours = (completedAt && startedAt) ? (completedAt - startedAt) / 3_600_000 : null;
      const queueTimeHours = (startedAt && notStartedAt) ? (startedAt - notStartedAt) / 3_600_000 : null;

      const epicTag = (fm.tags ?? []).find(t => t.startsWith('epic:'));
      const epic = epicTag ? epicTag.slice(5) : null;

      return {
        id: p.id,
        title: fm.title,
        completed_at: fm.completed_at ?? '',
        cycle_time_hours: cycleTimeHours !== null ? Math.round(cycleTimeHours * 10) / 10 : null,
        queue_time_hours: queueTimeHours !== null ? Math.round(queueTimeHours * 10) / 10 : null,
        lines: p.lineCount,
        tags: fm.tags ?? [],
        epic,
        sessions: fm.sessions ?? null,
        deviation: fm.deviation ?? null,
      };
    });

    // Aggregate stats
    const cycleTimes = plans.map(p => p.cycle_time_hours).filter((v): v is number => v !== null);
    const medianCycleTime = median(cycleTimes);

    const plansPerEpic: Record<string, number> = {};
    for (const p of plans) {
      if (p.epic) {
        plansPerEpic[p.epic] = (plansPerEpic[p.epic] ?? 0) + 1;
      }
    }

    return {
      plans,
      total_completed: plans.length,
      median_cycle_time_hours: medianCycleTime,
      plans_per_epic: plansPerEpic,
    };
  }

  create(id: string, opts: CreateOptions): CreateResult {
    const plansDir = join(this.projectDir, this.config.plans_dir);
    return computeCreate(
      { id, opts, plansDir, graph: this.graphData },
      { refresh: () => this.refresh() },
    );
  }

  set(planId: string, field: string, value: string | string[], mode: 'replace' | 'add' | 'remove' = 'replace'): SetResult {
    const plan = this.graphData.plans.get(planId);
    if (!plan) throw new Error(`Plan "${planId}" not found.`);

    if (field === 'status') {
      throw new Error('Cannot set "status" — use update() for status transitions.');
    }

    if (!(EDITABLE_FIELDS as readonly string[]).includes(field)) {
      throw new Error(`Unknown field "${field}". Editable fields: ${EDITABLE_FIELDS.join(', ')}`);
    }

    const isList = (LIST_FIELDS as readonly string[]).includes(field);
    const fm = plan.frontmatter as Record<string, any>;
    const previousValue = fm[field];

    if (mode !== 'replace' && !isList) {
      throw new Error(`Field "${field}" is not a list — cannot use ${mode} mode.`);
    }

    let newValue: string | string[];

    if (mode === 'add') {
      const current = Array.isArray(fm[field]) ? [...fm[field]] : [];
      const toAdd = Array.isArray(value) ? value : [value];
      // Validate depends_on references
      if (field === 'depends_on') {
        for (const dep of toAdd) {
          if (!this.graphData.plans.has(dep)) {
            throw new Error(`Dependency "${dep}" not found.`);
          }
        }
      }
      newValue = [...current, ...toAdd];
    } else if (mode === 'remove') {
      const current = Array.isArray(fm[field]) ? [...fm[field]] : [];
      const toRemove = Array.isArray(value) ? value : [value];
      newValue = current.filter((item: string) => !toRemove.includes(item));
    } else {
      // replace mode
      if (field === 'depends_on') {
        const deps = Array.isArray(value) ? value : [value];
        for (const dep of deps) {
          if (!this.graphData.plans.has(dep)) {
            throw new Error(`Dependency "${dep}" not found.`);
          }
        }
        newValue = deps;
      } else if (isList) {
        newValue = Array.isArray(value) ? value : [value];
      } else if (field === 'sessions') {
        const raw = typeof value === 'string' ? value : value[0];
        const num = Number(raw);
        if (!Number.isInteger(num) || num < 1) {
          throw new Error(`"sessions" must be a positive integer, got "${raw}".`);
        }
        newValue = num as any;
      } else if (field === 'deviation') {
        const raw = typeof value === 'string' ? value : value[0];
        if (raw !== 'none' && raw !== 'minor' && raw !== 'major') {
          throw new Error(`"deviation" must be "none", "minor", or "major", got "${raw}".`);
        }
        newValue = raw;
      } else {
        newValue = typeof value === 'string' ? value : value[0];
      }
    }

    updatePlanFile(plan.filePath, { [field]: newValue } as Partial<PlanFrontmatter>);
    this.refresh();

    return { id: planId, field, value: newValue, previousValue };
  }

  writeSection(planId: string, file: string, section: string, content: string): WriteSectionResult {
    const plan = this.graphData.plans.get(planId);
    if (!plan) throw new Error(`Plan "${planId}" not found.`);

    const fileName = FILE_NAME_MAP[file];
    if (!fileName) throw new Error(`Invalid file "${file}". Must be one of: ${Object.keys(FILE_NAME_MAP).join(', ')}`);

    const planDir = dirname(plan.filePath);
    const filePath = join(planDir, fileName);

    if (fileName === PlanFile.README) {
      // For README, we need to preserve frontmatter
      const raw = readFileSync(filePath, 'utf8');
      const parsed = matter(raw);
      const newBody = writeSection(parsed.content, section, content);
      const updated = matter.stringify(newBody, parsed.data);
      writeFileSync(filePath, updated);
    } else {
      // For non-README files, create if missing (only inputs/outputs)
      let existing = '';
      if (existsSync(filePath)) {
        existing = readFileSync(filePath, 'utf8');
      } else if (fileName === PlanFile.INPUTS || fileName === PlanFile.OUTPUTS) {
        // Create the file
        existing = '';
      } else {
        throw new Error(`File ${fileName} does not exist for plan "${planId}".`);
      }
      const updated = writeSection(existing, section, content);
      writeFileSync(filePath, updated);
    }

    this.refresh();
    return { id: planId, file, section, content };
  }

  readSection(planId: string, file?: string, section?: string): ReadSectionResult {
    const plan = this.graphData.plans.get(planId);
    if (!plan) throw new Error(`Plan "${planId}" not found.`);

    if (!file) {
      // Return all plan files concatenated
      const planDir = dirname(plan.filePath);
      let result = '';
      for (const [name, fileName] of Object.entries(FILE_NAME_MAP)) {
        const filePath = join(planDir, fileName);
        if (existsSync(filePath)) {
          let content = readFileSync(filePath, 'utf8');
          // Strip frontmatter from README
          if (fileName === PlanFile.README) {
            const parsed = parseFrontmatter(content);
            if (parsed) content = parsed.body;
          }
          if (result) result += '\n---\n\n';
          result += `# ${name}\n\n${content}`;
        }
      }
      return { id: planId, content: result };
    }

    const fileName = FILE_NAME_MAP[file];
    if (!fileName) throw new Error(`Invalid file "${file}". Must be one of: ${Object.keys(FILE_NAME_MAP).join(', ')}`);

    const planDir = dirname(plan.filePath);
    const filePath = join(planDir, fileName);

    if (!existsSync(filePath)) {
      throw new Error(`File ${fileName} does not exist for plan "${planId}".`);
    }

    let content = readFileSync(filePath, 'utf8');

    // For README, strip frontmatter for the body
    if (fileName === PlanFile.README) {
      const parsed = parseFrontmatter(content);
      if (parsed) content = parsed.body;
    }

    if (!section) {
      return { id: planId, file, content };
    }

    const sectionContent = readSection(content, section);
    if (sectionContent === null) {
      throw new Error(`Section "${section}" not found in ${fileName} for plan "${planId}".`);
    }

    return { id: planId, file, section, content: sectionContent };
  }

  rename(oldId: string, newId: string): RenameResult {
    validatePlanId(newId);

    const plan = this.graphData.plans.get(oldId);
    if (!plan) throw new Error(`Plan "${oldId}" not found.`);

    const plansDir = join(this.projectDir, this.config.plans_dir);
    const newDir = join(plansDir, newId);

    if (existsSync(newDir)) {
      throw new Error(`Plan "${newId}" already exists.`);
    }

    const oldDir = dirname(plan.filePath);
    renameSync(oldDir, newDir);

    // Update depends_on references in all other plans
    const referencesUpdated: string[] = [];
    for (const [id, p] of this.graphData.plans) {
      if (id === oldId) continue;
      if (p.frontmatter.depends_on?.includes(oldId)) {
        const newDeps = p.frontmatter.depends_on.map(d => d === oldId ? newId : d);
        updatePlanFile(join(plansDir, id, 'README.md'), { depends_on: newDeps });
        referencesUpdated.push(id);
      }
    }

    this.refresh();
    return { oldId, newId, referencesUpdated };
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
    const plan = this.graphData.plans.get(planId);
    if (!plan) throw new Error(`Plan "${planId}" not found.`);

    // Check for active dependents
    const dependents = this.graphData.dependents.get(planId) ?? [];
    const activeDependents = dependents.filter(depId => {
      const dep = this.graphData.plans.get(depId);
      return dep && dep.frontmatter.status !== 'done' && dep.frontmatter.status !== 'archived';
    });

    if (activeDependents.length > 0) {
      throw new Error(`Cannot archive "${planId}" — has active dependents: ${activeDependents.join(', ')}`);
    }

    const previousStatus = plan.frontmatter.status;
    updatePlanFile(plan.filePath, { status: 'archived' });
    this.refresh();

    return { id: planId, previousStatus, newStatus: 'archived' };
  }
}
