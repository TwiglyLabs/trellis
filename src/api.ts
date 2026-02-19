import { join, dirname } from 'path';
import { EventEmitter } from 'events';
import { watch as fsWatch, type FSWatcher, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync } from 'fs';
import matter from 'gray-matter';
import { loadConfig, scanPlans } from './scanner.ts';
import { buildGraph, detectCycles, transitiveDependents, computeCriticalPath, pickNext, computeChunks, newlyReady } from './graph.ts';
import { parseFrontmatter, validateFrontmatter, updatePlanFile } from './frontmatter.ts';
import { validateStatusGate, detectSections, readSection, writeSection } from './schema.ts';
import { filterPlans, VALID_STATUSES } from './utils.ts';
import { discoverManifest, fetchProjectPlans, type GitExecutor } from './manifest.ts';
import { PlanFile } from './types.ts';
import type { GraphData, Chunk, CrossChunkEdge, ChunkResult } from './graph.ts';
import type { Plan, PlanStatus, TrellisConfig, ContractSection, PlanFrontmatter, GateResult } from './types.ts';

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

/** Validate that a plan ID is a safe, single directory name. */
function validatePlanId(id: string): void {
  if (!id || id.trim() !== id) {
    throw new Error(`Invalid plan ID "${id}". Must be a non-empty, trimmed string.`);
  }
  if (/[\/\\]/.test(id) || id === '.' || id === '..' || id.startsWith('.')) {
    throw new Error(`Invalid plan ID "${id}". Must be a simple directory name (no slashes, no leading dot).`);
  }
  if (/[<>:"|?*\x00-\x1f]/.test(id)) {
    throw new Error(`Invalid plan ID "${id}". Contains invalid characters.`);
  }
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

  update(planId: string, status: PlanStatus, options?: { force?: boolean }): UpdateResult {
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const plan = this.graphData.plans.get(planId);
    if (!plan) {
      throw new Error(`Plan "${planId}" not found.`);
    }

    // Gate validation (skip with --force)
    if (!options?.force) {
      const hasDependents = (this.graphData.dependents.get(planId) ?? []).length > 0;
      const gate = validateStatusGate(plan, status, hasDependents);
      if (!gate.pass) {
        const details = gate.missing.map(m => `  - ${m}`).join('\n');
        throw new Error(`Cannot transition "${planId}" to ${status}:\n${details}\n\nUse --force to bypass.`);
      }
    }

    const previousStatus = plan.frontmatter.status;
    const oldOrder = STATUS_ORDER[previousStatus] ?? 0;
    const newOrder = STATUS_ORDER[status] ?? 0;
    const backward = newOrder < oldOrder;

    const updates: Partial<PlanFrontmatter> = { status };
    const deleteFields: string[] = [];

    if (status === 'not_started' && !plan.frontmatter.not_started_at) {
      updates.not_started_at = new Date().toISOString();
    }
    if (status === 'in_progress' && !plan.frontmatter.started_at) {
      updates.started_at = new Date().toISOString();
    }
    if (status === 'done' && !plan.frontmatter.completed_at) {
      updates.completed_at = new Date().toISOString();
    }
    if (backward) {
      if (newOrder < STATUS_ORDER.not_started && plan.frontmatter.not_started_at) {
        deleteFields.push('not_started_at');
      }
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

  lint(options?: { strict?: boolean; fix?: boolean }): LintResult {
    const plans = this.plans;
    const graph = this.graphData;
    const planIds = new Set(plans.map(p => p.id));
    const plansWithErrors = new Set<string>();
    const errors: LintIssue[] = [];
    const warnings: LintIssue[] = [];
    const structuralErrors: LintIssue[] = [];
    const structuralWarnings: LintIssue[] = [];
    const fixed: string[] = [];

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

    // --- Structural checks ---

    // Scan plans directory for malformed entries (single files, dirs without README.md)
    const plansDir = join(this.projectDir, this.config.plans_dir);
    if (existsSync(plansDir)) {
      let entries: string[];
      try { entries = readdirSync(plansDir); } catch { entries = []; }
      for (const entry of entries) {
        const fullPath = join(plansDir, entry);
        try {
          const stat = statSync(fullPath);
          if (!stat.isDirectory() && entry.endsWith('.md')) {
            structuralErrors.push({ planId: entry, type: 'single_file_plan', message: `${entry} is a single file, not a plan directory` });
            plansWithErrors.add(entry);
          } else if (stat.isDirectory() && !existsSync(join(fullPath, 'README.md'))) {
            structuralErrors.push({ planId: entry, type: 'missing_readme', message: `${entry}/ is missing README.md` });
            plansWithErrors.add(entry);
          }
        } catch { /* skip unreadable entries */ }
      }
    }

    for (const plan of plans) {
      const planDir = dirname(plan.filePath);
      const hasDependents = (graph.dependents.get(plan.id) ?? []).length > 0;
      const hasDependsOn = (plan.frontmatter.depends_on ?? []).length > 0;

      // File layout warnings
      if (hasDependsOn && !existsSync(join(planDir, PlanFile.INPUTS))) {
        structuralWarnings.push({ planId: plan.id, type: 'missing_inputs', message: `${plan.id} has depends_on but no inputs.md` });
      }
      if (hasDependents && !existsSync(join(planDir, PlanFile.OUTPUTS))) {
        structuralWarnings.push({ planId: plan.id, type: 'missing_outputs', message: `${plan.id} has dependents but no outputs.md` });
      }

      // inputs.md section warning
      if (existsSync(join(planDir, PlanFile.INPUTS))) {
        const inputsContent = readFileSync(join(planDir, PlanFile.INPUTS), 'utf8');
        const inputsSections = detectSections(inputsContent);
        const hasFromPlans = inputsSections.includes('From plans');
        const hasFromCode = inputsSections.includes('From existing code');
        if (!hasFromPlans && !hasFromCode) {
          structuralWarnings.push({ planId: plan.id, type: 'inputs_sections', message: `${plan.id} inputs.md missing "## From plans" or "## From existing code"` });
        }
      }

      // Status gate compliance
      const gate = validateStatusGate(plan, plan.frontmatter.status, hasDependents);
      if (!gate.pass) {
        for (const missing of gate.missing) {
          structuralErrors.push({ planId: plan.id, type: 'gate_violation', message: `${plan.id}: ${missing}` });
          plansWithErrors.add(plan.id);
        }

        // --fix: scaffold missing files and sections
        if (options?.fix) {
          this._fixStructuralIssues(plan, gate.missing, fixed);
        }
      }
    }

    const allErrors = [...errors, ...structuralErrors];
    const allWarnings = [...warnings, ...structuralWarnings];
    const ok = allErrors.length === 0 && (options?.strict ? allWarnings.length === 0 : true);

    return {
      ok,
      total: plans.length,
      okCount: plans.length - plansWithErrors.size,
      errors: allErrors,
      warnings: allWarnings,
      structural: { errors: structuralErrors, warnings: structuralWarnings },
      fixed,
    };
  }

  private _fixStructuralIssues(plan: Plan, missing: string[], fixed: string[]): void {
    const planDir = dirname(plan.filePath);

    for (const item of missing) {
      // Missing file: implementation.md
      if (item === 'Missing file: implementation.md') {
        const implPath = join(planDir, PlanFile.IMPLEMENTATION);
        if (!existsSync(implPath)) {
          writeFileSync(implPath, '## Steps\n\n\n## Testing\n\n\n## Done-when\n\n');
          fixed.push(`${plan.id}: created implementation.md`);
        }
      }

      // Missing file: outputs.md
      if (item.startsWith('Missing file: outputs.md')) {
        const outputsPath = join(planDir, PlanFile.OUTPUTS);
        if (!existsSync(outputsPath)) {
          writeFileSync(outputsPath, '## Outputs\n\n');
          fixed.push(`${plan.id}: created outputs.md`);
        }
      }

      // Missing sections in README.md
      const readmeSectionMatch = item.match(/^README\.md: missing "## (.+)"$/);
      if (readmeSectionMatch) {
        const sectionName = readmeSectionMatch[1];
        const raw = readFileSync(plan.filePath, 'utf8');
        const parsed = matter(raw);
        const sections = detectSections(parsed.content);
        if (!sections.includes(sectionName)) {
          const newBody = writeSection(parsed.content, sectionName, '\n');
          const updated = matter.stringify(newBody, parsed.data);
          writeFileSync(plan.filePath, updated);
          fixed.push(`${plan.id}: added ## ${sectionName} to README.md`);
        }
      }

      // Missing sections in implementation.md
      const implSectionMatch = item.match(/^implementation\.md: missing "## (.+)"$/);
      if (implSectionMatch) {
        const sectionName = implSectionMatch[1];
        const implPath = join(planDir, PlanFile.IMPLEMENTATION);
        if (existsSync(implPath)) {
          const content = readFileSync(implPath, 'utf8');
          const sections = detectSections(content);
          if (!sections.includes(sectionName)) {
            const updated = writeSection(content, sectionName, '\n');
            writeFileSync(implPath, updated);
            fixed.push(`${plan.id}: added ## ${sectionName} to implementation.md`);
          }
        }
      }
    }
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
    if (!opts.title) {
      throw new Error('title is required');
    }

    validatePlanId(id);

    const plansDir = join(this.projectDir, this.config.plans_dir);
    const planDir = join(plansDir, id);

    if (existsSync(planDir)) {
      throw new Error(`Plan "${id}" already exists.`);
    }

    // Validate depends_on references
    if (opts.depends_on?.length) {
      for (const dep of opts.depends_on) {
        if (!this.graphData.plans.has(dep)) {
          throw new Error(`Dependency "${dep}" not found.`);
        }
      }
    }

    mkdirSync(planDir, { recursive: true });

    const data: Record<string, any> = { title: opts.title, status: 'draft' };
    if (opts.description) data.description = opts.description;
    if (opts.depends_on?.length) data.depends_on = opts.depends_on;
    if (opts.tags?.length) data.tags = opts.tags;

    const body = '\n## Problem\n\n\n## Approach\n\n';
    const content = matter.stringify(body, data);
    const filePath = join(planDir, 'README.md');
    writeFileSync(filePath, content);

    this.refresh();

    return { id, filePath };
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
