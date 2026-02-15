# Phase 2: High-Level API Layer

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Build a `Trellis` class that provides the high-level API an Electron app actually wants — a single entry point that manages config loading, plan scanning, graph building, and exposes composed query methods. This is where the library API adds value over the CLI: structured return types instead of console output, reactive refresh capability, rich computed properties, and no I/O mixed into logic.

**Architecture:** A single `Trellis` class in `src/api.ts` wraps the existing pure functions into a stateful session. It loads config, scans once (or on-demand), caches the graph, and exposes methods that return typed data objects. The class is lazy — it doesn't scan until you call a method or explicitly `refresh()`. All methods return plain objects (no chalk, no console.log, no process.exit). The Electron app creates one `Trellis` instance pointed at a project directory and calls methods on it.

**Tech Stack:** TypeScript

**Related:** [./phase-1.md](./phase-1.md), [./phase-3.md](./phase-3.md), [../README.md](../README.md)

---

## Design Rationale: Why a Class?

The CLI commands each independently call `loadConfig()`, `scanPlans()`, `buildGraph()`. That's fine for a CLI where each invocation is a fresh process. For a library consumer (especially Electron), you want:

1. **Single initialization** — load config once, pass the project path once
2. **Cached graph** — don't rescan the filesystem on every query
3. **Explicit refresh** — rescan when the user requests it (or on file watch)
4. **Composed queries** — `status()` returns a structured object with ready/blocked/in-progress already categorized, not raw plan arrays

The class holds `config`, `plans`, and `graph` as private state. Public methods compute and return typed result objects.

---

## Return Types

Define these in `src/api.ts` alongside the class. They mirror what the CLI commands currently compute and print, but as structured data:

```typescript
interface StatusResult {
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

interface PlanSummary {
  id: string;
  title: string;
  status: PlanStatus;
  description?: string;
  tags: string[];
  repo?: string;
  assignee?: string;
}

interface BlockedPlanSummary extends PlanSummary {
  waitingOn: string[];
}

interface ReadyResult {
  plans: PlanSummary[];
  next: string | null;
}

interface ShowResult {
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

interface DependencyInfo {
  id: string;
  status: PlanStatus | 'not_found';
  satisfied: boolean;
}

interface UpdateResult {
  id: string;
  previousStatus: PlanStatus;
  newStatus: PlanStatus;
  backward: boolean;
  newlyReady: string[];
}

interface LintResult {
  ok: boolean;
  total: number;
  okCount: number;
  errors: LintIssue[];
  warnings: LintIssue[];
  contractCoverage: number;
}

interface LintIssue {
  planId: string;
  type: string;
  message: string;
}

interface EpicResult {
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

interface GraphResult {
  project: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  chunks: Chunk[];
  crossChunkEdges: CrossChunkEdge[];
}

interface GraphNode {
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

interface GraphEdge {
  from: string;
  to: string;
}
```

---

## Error Behavior

The library API is consumed by Electron, not a terminal. It cannot `process.exit()` or print to stdout. All errors are thrown exceptions with descriptive messages. The consumer (Electron) catches and displays them.

| Scenario | Behavior |
|---|---|
| Constructor: no `.trellis` config file | Throws `Error('No .trellis config found in <path>')` |
| Constructor: malformed `.trellis` config | Throws `Error('Invalid .trellis config: <details>')` |
| `update()`: unknown plan ID | Throws `Error('Plan "<id>" not found.')` |
| `update()`: invalid status value | Throws `Error('Invalid status "<val>". Must be one of: ...')` |
| `show()`: unknown plan ID | Returns `null` (not an error — the plan may not exist yet) |
| `scanPlans()`: corrupt frontmatter in a plan file | Skips the file, includes a validation warning (same as CLI behavior) |
| `lint()`: no plans found | Returns clean `LintResult` with `total: 0, ok: true` |
| Any method after `refresh()`: filesystem error | Throws the underlying `fs` error (ENOENT, EACCES, etc.) |

The constructor eagerly loads config (throws immediately on bad config). All other I/O is lazy — errors surface when the first query method is called.

---

### Task 1: Create the Trellis class with config and refresh

**Files:**
- Create: `src/api.ts`
- Create: `tests/api.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/api.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Trellis } from '../src/api.ts';

function createTestProject() {
  const tmpDir = join(tmpdir(), `trellis-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const plansDir = join(tmpDir, 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');
  return { tmpDir, plansDir };
}

function writePlan(plansDir: string, id: string, frontmatter: Record<string, unknown>) {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - ${i}`).join('\n')}`;
      return `${k}: ${v}`;
    })
    .join('\n');
  const parts = id.split('/');
  if (parts.length > 1) {
    mkdirSync(join(plansDir, ...parts.slice(0, -1)), { recursive: true });
  }
  writeFileSync(join(plansDir, `${id}.md`), `---\n${fm}\n---\n\nBody for ${id}\n`);
}

describe('Trellis class', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes with project directory', () => {
    const t = new Trellis(tmpDir);
    expect(t.config.project).toBe('test-project');
  });

  it('scans lazily on first query', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const t = new Trellis(tmpDir);
    // No scan yet — calling status triggers it
    const result = t.status();
    expect(result.total).toBe(1);
  });

  it('refresh rescans from disk', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const t = new Trellis(tmpDir);
    const r1 = t.status();
    expect(r1.total).toBe(1);

    writePlan(plansDir, 'b', { title: 'B', status: 'not_started' });
    t.refresh();
    const r2 = t.status();
    expect(r2.total).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/api.test.ts`
Expected: FAIL — `../src/api.ts` does not exist

**Step 3: Write the Trellis class skeleton**

```typescript
// src/api.ts
import { join } from 'path';
import { loadConfig, scanPlans } from './scanner.ts';
import { buildGraph } from './graph.ts';
import type { GraphData } from './graph.ts';
import type { Plan, TrellisConfig } from './types.ts';

export class Trellis {
  readonly projectDir: string;
  readonly config: TrellisConfig;

  private _plans: Plan[] | null = null;
  private _graph: GraphData | null = null;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.config = loadConfig(projectDir);
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

  // status() placeholder — full implementation in Task 2
  status(_filters?: { tag?: string; repo?: string; showDone?: boolean; showArchived?: boolean }): any {
    return { project: this.config.project, total: this.plans.length, byStatus: {}, chunks: {} };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api.ts tests/api.test.ts
git commit -m "feat: add Trellis class with lazy loading and refresh"
```

---

### Task 2: Implement status()

**Files:**
- Modify: `src/api.ts`
- Modify: `tests/api.test.ts`

**Step 1: Write the failing test**

Add to `tests/api.test.ts`:

```typescript
describe('Trellis.status()', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('categorizes plans by status', () => {
    writePlan(plansDir, 'done-plan', { title: 'Done', status: 'done' });
    writePlan(plansDir, 'ready-plan', { title: 'Ready', status: 'not_started', depends_on: ['done-plan'] });
    writePlan(plansDir, 'blocked-plan', { title: 'Blocked', status: 'not_started', depends_on: ['ready-plan'] });
    writePlan(plansDir, 'ip-plan', { title: 'In Progress', status: 'in_progress' });
    writePlan(plansDir, 'draft-plan', { title: 'Draft', status: 'draft' });

    const t = new Trellis(tmpDir);
    const result = t.status();

    expect(result.project).toBe('test-project');
    expect(result.total).toBe(5);
    expect(result.byStatus.ready).toHaveLength(1);
    expect(result.byStatus.ready[0].id).toBe('ready-plan');
    expect(result.byStatus.blocked).toHaveLength(1);
    expect(result.byStatus.blocked[0].id).toBe('blocked-plan');
    expect(result.byStatus.blocked[0].waitingOn).toEqual(['ready-plan']);
    expect(result.byStatus.inProgress).toHaveLength(1);
    expect(result.byStatus.draft).toHaveLength(1);
    expect(result.byStatus.done).toHaveLength(1);
  });

  it('filters by tag', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started', tags: ['core'] });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', tags: ['extra'] });

    const t = new Trellis(tmpDir);
    const result = t.status({ tag: 'core' });
    expect(result.total).toBe(1);
    expect(result.byStatus.ready[0].id).toBe('a');
  });

  it('hides done/archived by default, shows with flags', () => {
    writePlan(plansDir, 'done', { title: 'Done', status: 'done' });
    writePlan(plansDir, 'archived', { title: 'Archived', status: 'archived' });
    writePlan(plansDir, 'active', { title: 'Active', status: 'not_started' });

    const t = new Trellis(tmpDir);

    const defaultResult = t.status();
    // total always reflects all plans regardless of visibility filters
    expect(defaultResult.total).toBe(3);
    expect(defaultResult.byStatus.done).toHaveLength(0);
    expect(defaultResult.byStatus.archived).toHaveLength(0);

    const allResult = t.status({ showDone: true, showArchived: true });
    expect(allResult.total).toBe(3);
    expect(allResult.byStatus.done).toHaveLength(1);
    expect(allResult.byStatus.archived).toHaveLength(1);
  });

  it('includes chunk summary', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const t = new Trellis(tmpDir);
    const result = t.status();
    expect(result.chunks).toBeDefined();
    expect(typeof result.chunks.total).toBe('number');
    expect(typeof result.chunks.overBudget).toBe('number');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/api.test.ts`
Expected: FAIL — `byStatus` property doesn't exist on the placeholder status()

**Step 3: Implement status()**

In `src/api.ts`, import `computeChunks` and `filterPlans`, define the return types, and implement:

```typescript
import { computeChunks } from './graph.ts';
import { filterPlans } from './utils.ts';
import type { PlanStatus, ContractSection } from './types.ts';

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

// Inside the Trellis class:

status(filters?: { tag?: string; repo?: string; showDone?: boolean; showArchived?: boolean }): StatusResult {
  const allPlans = filterPlans(this.plans, { tag: filters?.tag, repo: filters?.repo });
  const total = allPlans.length;

  // Filter display list (done/archived hidden by default), but total always reflects all plans
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

  const toSummary = (p: Plan): PlanSummary => ({
    id: p.id,
    title: p.frontmatter.title,
    status: p.frontmatter.status,
    description: p.frontmatter.description,
    tags: p.frontmatter.tags ?? [],
    repo: p.frontmatter.repo,
    assignee: p.frontmatter.assignee,
  });

  const ready = plans.filter(p => graph.ready.has(p.id)).map(toSummary);
  const blocked = plans.filter(p => graph.blocked.has(p.id)).map(p => {
    const waitingOn = (p.frontmatter.depends_on ?? []).filter(d => {
      const dep = graph.plans.get(d);
      return !dep || dep.frontmatter.status !== 'done';
    });
    return { ...toSummary(p), waitingOn };
  });
  const inProgress = plans.filter(p => p.frontmatter.status === 'in_progress').map(toSummary);
  const draft = plans.filter(p => p.frontmatter.status === 'draft').map(toSummary);
  const done = plans.filter(p => p.frontmatter.status === 'done').map(toSummary);
  const archived = plans.filter(p => p.frontmatter.status === 'archived').map(toSummary);

  return {
    project: this.config.project,
    total,
    chunks: { total: chunkResult.chunks.length, overBudget },
    byStatus: { ready, blocked, inProgress, draft, done, archived },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api.ts tests/api.test.ts
git commit -m "feat: implement Trellis.status() with categorized results"
```

---

### Task 3: Implement ready() and show()

**Files:**
- Modify: `src/api.ts`
- Modify: `tests/api.test.ts`

**Step 1: Write failing tests**

```typescript
describe('Trellis.ready()', () => {
  // ... setup boilerplate as above ...

  it('returns ready plans and next pick', () => {
    writePlan(plansDir, 'done', { title: 'Done', status: 'done' });
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started', depends_on: ['done'] });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', depends_on: ['done'] });
    writePlan(plansDir, 'blocked', { title: 'Blocked', status: 'not_started', depends_on: ['a'] });

    const t = new Trellis(tmpDir);
    const result = t.ready();
    expect(result.plans).toHaveLength(2);
    expect(result.plans.map(p => p.id).sort()).toEqual(['a', 'b']);
    expect(result.next).toBeTruthy();
    expect(['a', 'b']).toContain(result.next);
  });

  it('filters by tag', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started', tags: ['core'] });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', tags: ['extra'] });

    const t = new Trellis(tmpDir);
    const result = t.ready({ tag: 'core' });
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].id).toBe('a');
  });
});

describe('Trellis.show()', () => {
  // ... setup boilerplate as above ...

  it('returns full plan details', () => {
    writePlan(plansDir, 'dep', { title: 'Dep', status: 'done' });
    writePlan(plansDir, 'main', { title: 'Main', status: 'not_started', depends_on: ['dep'], tags: ['core'], repo: 'public' });
    writePlan(plansDir, 'child', { title: 'Child', status: 'not_started', depends_on: ['main'] });

    const t = new Trellis(tmpDir);
    const result = t.show('main');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('main');
    expect(result!.title).toBe('Main');
    expect(result!.ready).toBe(true);
    expect(result!.blocked).toBe(false);
    expect(result!.dependsOn).toHaveLength(1);
    expect(result!.dependsOn[0].id).toBe('dep');
    expect(result!.dependsOn[0].satisfied).toBe(true);
    expect(result!.blocks).toContain('child');
    expect(result!.criticalPath).toEqual(['dep', 'main']);
    expect(result!.body).toContain('Body for main');
  });

  it('returns null for unknown plan', () => {
    const t = new Trellis(tmpDir);
    expect(t.show('nonexistent')).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/api.test.ts`
Expected: FAIL — `ready()` and `show()` not defined

**Step 3: Implement ready() and show()**

```typescript
// Return types (add to src/api.ts)
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

// Inside the Trellis class:

ready(filters?: { tag?: string; repo?: string }): ReadyResult {
  let readyPlans = this.plans.filter(p => this.graphData.ready.has(p.id));
  readyPlans = filterPlans(readyPlans, { tag: filters?.tag, repo: filters?.repo });

  const filteredIds = new Set(readyPlans.map(p => p.id));
  const next = pickNext(this.graphData, filteredIds);

  return {
    plans: readyPlans.map(p => ({
      id: p.id,
      title: p.frontmatter.title,
      status: p.frontmatter.status,
      description: p.frontmatter.description,
      tags: p.frontmatter.tags ?? [],
      repo: p.frontmatter.repo,
      assignee: p.frontmatter.assignee,
    })),
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
```

**Step 4: Run tests**

Run: `npm test -- tests/api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api.ts tests/api.test.ts
git commit -m "feat: implement Trellis.ready() and Trellis.show()"
```

---

### Task 4: Implement update()

**Files:**
- Modify: `src/api.ts`
- Modify: `tests/api.test.ts`

**Step 1: Write failing test**

```typescript
describe('Trellis.update()', () => {
  // ... setup boilerplate ...

  it('updates plan status and returns result', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', depends_on: ['a'] });

    const t = new Trellis(tmpDir);
    const result = t.update('a', 'done');

    expect(result.id).toBe('a');
    expect(result.previousStatus).toBe('not_started');
    expect(result.newStatus).toBe('done');
    expect(result.newlyReady).toEqual(['b']);
  });

  it('throws on invalid status', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const t = new Trellis(tmpDir);
    expect(() => t.update('a', 'invalid' as any)).toThrow();
  });

  it('throws on unknown plan', () => {
    const t = new Trellis(tmpDir);
    expect(() => t.update('nonexistent', 'done')).toThrow();
  });

  it('auto-refreshes after update', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const t = new Trellis(tmpDir);

    t.update('a', 'in_progress');
    const result = t.status({ showDone: true, showArchived: true });
    expect(result.byStatus.inProgress).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/api.test.ts`
Expected: FAIL — `update()` not defined

**Step 3: Implement update()**

```typescript
// Return type
export interface UpdateResult {
  id: string;
  previousStatus: PlanStatus;
  newStatus: PlanStatus;
  backward: boolean;
  newlyReady: string[];
}

// Inside the Trellis class:

update(planId: string, status: PlanStatus): UpdateResult {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const plan = this.graphData.plans.get(planId);
  if (!plan) {
    throw new Error(`Plan "${planId}" not found.`);
  }

  const previousStatus = plan.frontmatter.status;
  const STATUS_ORDER: Record<string, number> = {
    draft: 0, not_started: 1, in_progress: 2, done: 3, archived: 4,
  };
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
```

**Step 4: Run tests**

Run: `npm test -- tests/api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api.ts tests/api.test.ts
git commit -m "feat: implement Trellis.update() with auto-refresh"
```

---

### Task 5: Implement lint()

**Files:**
- Modify: `src/api.ts`
- Modify: `tests/api.test.ts`

**Step 1: Write failing test**

```typescript
describe('Trellis.lint()', () => {
  // ... setup boilerplate ...

  it('returns clean result for valid plans', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', depends_on: ['a'] });

    const t = new Trellis(tmpDir);
    const result = t.lint();
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports missing dependencies', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started', depends_on: ['nonexistent'] });

    const t = new Trellis(tmpDir);
    const result = t.lint();
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.type === 'missing_dependency')).toBe(true);
  });

  it('strict mode fails on warnings', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'draft' });

    const t = new Trellis(tmpDir);
    const relaxed = t.lint();
    const strict = t.lint({ strict: true });
    // Orphan draft = warning
    expect(relaxed.ok).toBe(true);
    expect(strict.ok).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement lint()**

Extract the validation logic from `src/commands/lint.ts` into a pure function. The implementation mirrors the command but returns data instead of printing.

```typescript
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

// Inside the Trellis class:

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

  // Inconsistencies
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
```

**Step 4: Run tests**

Run: `npm test -- tests/api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api.ts tests/api.test.ts
git commit -m "feat: implement Trellis.lint() with error and warning categories"
```

---

### Task 6: Implement graph(), epic(), and chunks()

**Files:**
- Modify: `src/api.ts`
- Modify: `tests/api.test.ts`

**Step 1: Write failing tests**

```typescript
describe('Trellis.graph()', () => {
  // ... setup boilerplate ...

  it('returns nodes, edges, chunks and cross-chunk edges', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', depends_on: ['a'] });

    const t = new Trellis(tmpDir);
    const result = t.graph();

    expect(result.project).toBe('test-project');
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({ from: 'a', to: 'b' });
    expect(result.nodes.find(n => n.id === 'a')!.status).toBe('done');
    expect(result.nodes.find(n => n.id === 'b')!.ready).toBe(true);
    expect(Array.isArray(result.chunks)).toBe(true);
    expect(Array.isArray(result.crossChunkEdges)).toBe(true);
  });

  it('includes plan body for detail views', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const t = new Trellis(tmpDir);
    const result = t.graph();
    expect(result.nodes[0].body).toContain('Body for a');
  });
});

describe('Trellis.epic()', () => {
  // ... setup boilerplate ...

  it('returns all epics when no name given', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done', tags: ['epic:v1'] });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', tags: ['epic:v1'] });
    writePlan(plansDir, 'c', { title: 'C', status: 'not_started', tags: ['epic:v2'] });

    const t = new Trellis(tmpDir);
    const result = t.epic();
    expect(result).toHaveLength(2);

    const v1 = result.find(e => e.epic === 'v1')!;
    expect(v1.total).toBe(2);
    expect(v1.done).toBe(1);
    expect(v1.progress).toBe(0.5);
  });

  it('returns single epic with plans when name given', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done', tags: ['epic:v1'] });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', tags: ['epic:v1'] });

    const t = new Trellis(tmpDir);
    const result = t.epic('v1');
    expect(result).toHaveLength(1);
    expect(result[0].plans).toHaveLength(2);
  });

  it('returns empty array for unknown epic', () => {
    const t = new Trellis(tmpDir);
    expect(t.epic('nonexistent')).toHaveLength(0);
  });
});

describe('Trellis.chunks()', () => {
  // ... setup boilerplate ...

  it('returns chunk result', () => {
    writePlan(plansDir, 'contracts/types', { title: 'Types', status: 'done' });
    writePlan(plansDir, 'contracts/api', { title: 'API', status: 'not_started', depends_on: ['contracts/types'] });
    writePlan(plansDir, 'impl/core', { title: 'Core', status: 'not_started', depends_on: ['contracts/types'] });

    const t = new Trellis(tmpDir);
    const result = t.chunks();
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(Array.isArray(result.crossChunkEdges)).toBe(true);
    expect(typeof result.config.maxLines).toBe('number');
  });
});
```

**Step 2: Run test to verify fails**

**Step 3: Implement graph(), epic(), chunks()**

```typescript
// Return types
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

export interface GraphEdge { from: string; to: string }

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

// Inside the class:

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
    result.plans = epicPlans.map(p => ({
      id: p.id,
      title: p.frontmatter.title,
      status: p.frontmatter.status,
      tags: p.frontmatter.tags ?? [],
      repo: p.frontmatter.repo,
      assignee: p.frontmatter.assignee,
      description: p.frontmatter.description,
    }));
  }
  return result;
}

chunks(filters?: { tag?: string; repo?: string; strategy?: 'directory' | 'topological' }): ChunkResult {
  // Always use the full graph (built from all plans) to avoid dangling dependency
  // references when filtering. computeChunks handles plan filtering internally.
  let plans = this.plans;
  if (filters?.tag || filters?.repo) {
    plans = filterPlans(plans, { tag: filters.tag, repo: filters.repo });
  }
  const strategy = filters?.strategy ?? this.config.chunk_strategy;
  return computeChunks(plans, this.graphData, { maxLines: this.config.chunk_max_lines, strategy });
}
```

**Step 4: Run tests**

Run: `npm test -- tests/api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api.ts tests/api.test.ts
git commit -m "feat: implement Trellis.graph(), .epic(), .chunks()"
```

---

### Task 7: Export the Trellis class and API types from barrel

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

**Step 1: Write failing test**

```typescript
it('exports Trellis class and API types', async () => {
  const lib = await import('../src/index.ts');
  expect(typeof lib.Trellis).toBe('function');
});
```

**Step 2: Run test to verify it fails**

**Step 3: Add export to barrel**

Add to `src/index.ts`:

```typescript
// --- High-Level API ---
export { Trellis } from './api.ts';
export type {
  StatusResult,
  PlanSummary,
  BlockedPlanSummary,
  ReadyResult,
  DependencyInfo,
  ShowResult,
  UpdateResult,
  LintIssue,
  LintResult,
  GraphNode,
  GraphEdge,
  GraphResult,
  EpicResult,
} from './api.ts';
```

**Step 4: Run tests**

Run: `npm test`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: export Trellis class and API types from barrel"
```

---

### Task 8: Consumer workflow integration tests

This is the high-value test. It exercises the library API the way Electron will actually use it: import from the barrel, create a `Trellis` instance, and run full workflows — not isolated method calls, but realistic sequences. These tests are the contract between the library and its consumers.

**Files:**
- Create: `tests/api-integration.test.ts`

**Step 1: Write the integration tests**

```typescript
// tests/api-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import from barrel — this is the consumer's entry point
import { Trellis } from '../src/index.ts';
import type {
  StatusResult,
  ReadyResult,
  ShowResult,
  UpdateResult,
  LintResult,
  GraphResult,
  EpicResult,
} from '../src/index.ts';

function createTestProject(plans: Record<string, Record<string, unknown>> = {}) {
  const tmpDir = join(tmpdir(), `trellis-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const plansDir = join(tmpDir, 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');

  for (const [id, frontmatter] of Object.entries(plans)) {
    const fm = Object.entries(frontmatter)
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - ${i}`).join('\n')}`;
        return `${k}: ${v}`;
      })
      .join('\n');
    const parts = id.split('/');
    if (parts.length > 1) {
      mkdirSync(join(plansDir, ...parts.slice(0, -1)), { recursive: true });
    }
    writeFileSync(join(plansDir, `${id}.md`), `---\n${fm}\n---\n\nBody for ${id}\n`);
  }

  return { tmpDir, plansDir };
}

describe('Consumer workflow: project overview', () => {
  let tmpDir: string;

  beforeEach(() => {
    const project = createTestProject({
      'contracts/types':   { title: 'Core Types', status: 'done', tags: ['foundation', 'epic:v1'] },
      'contracts/api':     { title: 'API Contract', status: 'done', depends_on: ['contracts/types'], tags: ['foundation', 'epic:v1'] },
      'impl/scanner':      { title: 'Scanner', status: 'in_progress', depends_on: ['contracts/types'], tags: ['core', 'epic:v1'] },
      'impl/graph':        { title: 'Graph Engine', status: 'not_started', depends_on: ['contracts/api'], tags: ['core', 'epic:v1'] },
      'impl/cli':          { title: 'CLI Layer', status: 'not_started', depends_on: ['impl/scanner', 'impl/graph'], tags: ['shell', 'epic:v2'] },
      'docs/readme':       { title: 'README', status: 'draft', tags: ['docs', 'epic:v2'] },
    });
    tmpDir = project.tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('status → ready → show → graph gives a consistent project view', () => {
    const t = new Trellis(tmpDir);

    // Status: full project overview
    const status: StatusResult = t.status({ showDone: true });
    expect(status.project).toBe('test-project');
    expect(status.total).toBe(6);
    expect(status.byStatus.done).toHaveLength(2);
    expect(status.byStatus.inProgress).toHaveLength(1);
    expect(status.byStatus.ready.map(p => p.id)).toContain('impl/graph');
    expect(status.byStatus.blocked.map(p => p.id)).toContain('impl/cli');

    // Ready: what's actionable
    const ready: ReadyResult = t.ready();
    expect(ready.plans.length).toBeGreaterThanOrEqual(1);
    expect(ready.next).toBeTruthy();

    // Show: deep dive into a specific plan
    const show: ShowResult = t.show('impl/cli')!;
    expect(show).not.toBeNull();
    expect(show.blocked).toBe(true);
    expect(show.dependsOn).toHaveLength(2);
    expect(show.dependsOn.find(d => d.id === 'impl/scanner')!.satisfied).toBe(false);
    expect(show.dependsOn.find(d => d.id === 'impl/graph')!.satisfied).toBe(false);
    expect(show.criticalPath.length).toBeGreaterThanOrEqual(2);
    expect(show.body).toContain('Body for impl/cli');

    // Graph: full DAG data for rendering
    const graph: GraphResult = t.graph();
    expect(graph.nodes).toHaveLength(6);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.nodes.find(n => n.id === 'impl/cli')!.blocked).toBe(true);
    expect(graph.nodes.find(n => n.id === 'impl/graph')!.ready).toBe(true);

    // Consistency: graph and status agree on state
    const readyFromGraph = graph.nodes.filter(n => n.ready).map(n => n.id).sort();
    const readyFromStatus = status.byStatus.ready.map(p => p.id).sort();
    expect(readyFromGraph).toEqual(readyFromStatus);
  });
});

describe('Consumer workflow: work on a plan', () => {
  let tmpDir: string;

  beforeEach(() => {
    const project = createTestProject({
      'foundation': { title: 'Foundation', status: 'done' },
      'feature-a':  { title: 'Feature A', status: 'not_started', depends_on: ['foundation'] },
      'feature-b':  { title: 'Feature B', status: 'not_started', depends_on: ['feature-a'] },
    });
    tmpDir = project.tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('update a plan and see downstream effects', () => {
    const t = new Trellis(tmpDir);

    // Before: feature-a is ready, feature-b is blocked
    expect(t.ready().plans.map(p => p.id)).toContain('feature-a');
    expect(t.show('feature-b')!.blocked).toBe(true);

    // Start work
    const startResult: UpdateResult = t.update('feature-a', 'in_progress');
    expect(startResult.previousStatus).toBe('not_started');
    expect(startResult.newStatus).toBe('in_progress');
    expect(startResult.backward).toBe(false);

    // Verify auto-refresh: status reflects the change
    const afterStart = t.status({ showDone: true });
    expect(afterStart.byStatus.inProgress.map(p => p.id)).toContain('feature-a');

    // Complete work
    const doneResult: UpdateResult = t.update('feature-a', 'done');
    expect(doneResult.newlyReady).toContain('feature-b');

    // feature-b is now unblocked
    expect(t.show('feature-b')!.blocked).toBe(false);
    expect(t.show('feature-b')!.ready).toBe(true);
    expect(t.ready().plans.map(p => p.id)).toContain('feature-b');
  });

  it('backward status transition clears timestamps', () => {
    const t = new Trellis(tmpDir);

    t.update('feature-a', 'in_progress');
    const afterStart = t.show('feature-a')!;
    expect(afterStart.startedAt).toBeTruthy();

    t.update('feature-a', 'done');
    const afterDone = t.show('feature-a')!;
    expect(afterDone.completedAt).toBeTruthy();

    // Revert to not_started
    const revertResult = t.update('feature-a', 'not_started');
    expect(revertResult.backward).toBe(true);

    const afterRevert = t.show('feature-a')!;
    expect(afterRevert.startedAt).toBeUndefined();
    expect(afterRevert.completedAt).toBeUndefined();
  });
});

describe('Consumer workflow: project health check', () => {
  let tmpDir: string;

  beforeEach(() => {
    const project = createTestProject({
      'valid-a': { title: 'Valid A', status: 'done' },
      'valid-b': { title: 'Valid B', status: 'not_started', depends_on: ['valid-a'] },
      'broken':  { title: 'Broken', status: 'not_started', depends_on: ['nonexistent'] },
      'orphan':  { title: 'Orphan', status: 'draft' },
    });
    tmpDir = project.tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lint detects errors and warnings', () => {
    const t = new Trellis(tmpDir);
    const result: LintResult = t.lint();

    expect(result.ok).toBe(false);
    expect(result.total).toBe(4);
    expect(result.errors.some(e => e.type === 'missing_dependency' && e.planId === 'broken')).toBe(true);
    expect(result.warnings.some(w => w.type === 'orphan' && w.planId === 'orphan')).toBe(true);
  });

  it('strict mode fails on warnings too', () => {
    const t = new Trellis(tmpDir);
    const relaxed = t.lint();
    const strict = t.lint({ strict: true });

    // relaxed: only errors matter
    // strict: warnings also cause failure
    expect(strict.ok).toBe(false);
    expect(strict.errors).toEqual(relaxed.errors);
    expect(strict.warnings).toEqual(relaxed.warnings);
  });
});

describe('Consumer workflow: epic tracking', () => {
  let tmpDir: string;

  beforeEach(() => {
    const project = createTestProject({
      'a': { title: 'A', status: 'done', tags: ['epic:v1'] },
      'b': { title: 'B', status: 'in_progress', tags: ['epic:v1'] },
      'c': { title: 'C', status: 'not_started', tags: ['epic:v1', 'epic:v2'] },
      'd': { title: 'D', status: 'not_started', tags: ['epic:v2'] },
    });
    tmpDir = project.tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks progress across epics', () => {
    const t = new Trellis(tmpDir);
    const epics: EpicResult[] = t.epic();

    expect(epics).toHaveLength(2);

    const v1 = epics.find(e => e.epic === 'v1')!;
    expect(v1.total).toBe(3);
    expect(v1.done).toBe(1);
    expect(v1.inProgress).toBe(1);
    expect(v1.progress).toBeCloseTo(1 / 3);

    const v2 = epics.find(e => e.epic === 'v2')!;
    expect(v2.total).toBe(2);
    expect(v2.done).toBe(0);
  });

  it('single epic includes plan details', () => {
    const t = new Trellis(tmpDir);
    const [v1]: EpicResult[] = t.epic('v1');

    expect(v1.plans).toBeDefined();
    expect(v1.plans).toHaveLength(3);
    expect(v1.plans!.map(p => p.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('Consumer workflow: error paths', () => {
  it('throws on missing .trellis config', () => {
    const tmpDir = join(tmpdir(), `trellis-noconfig-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      expect(() => new Trellis(tmpDir)).toThrow();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('show returns null for unknown plan', () => {
    const { tmpDir } = createTestProject({
      'a': { title: 'A', status: 'not_started' },
    });
    try {
      const t = new Trellis(tmpDir);
      expect(t.show('nonexistent')).toBeNull();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('update throws on unknown plan', () => {
    const { tmpDir } = createTestProject({
      'a': { title: 'A', status: 'not_started' },
    });
    try {
      const t = new Trellis(tmpDir);
      expect(() => t.update('nonexistent', 'done')).toThrow('not found');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('update throws on invalid status', () => {
    const { tmpDir } = createTestProject({
      'a': { title: 'A', status: 'not_started' },
    });
    try {
      const t = new Trellis(tmpDir);
      expect(() => t.update('a', 'invalid' as any)).toThrow('Invalid status');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles corrupt frontmatter gracefully', () => {
    const tmpDir = join(tmpdir(), `trellis-corrupt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const plansDir = join(tmpDir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');

    // Write a valid plan
    writeFileSync(join(plansDir, 'good.md'), '---\ntitle: Good Plan\nstatus: not_started\n---\n\nBody\n');
    // Write a plan with corrupt YAML
    writeFileSync(join(plansDir, 'corrupt.md'), '---\n: invalid yaml {{{\nstatus: [broken\n---\n\nBody\n');

    try {
      const t = new Trellis(tmpDir);

      // status() should work, skipping the corrupt plan
      const status = t.status();
      expect(status.total).toBe(1); // only the good plan

      // lint() should report the issue
      const lint = t.lint();
      expect(lint.total).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Consumer workflow: chunks and filtering', () => {
  let tmpDir: string;

  beforeEach(() => {
    const project = createTestProject({
      'contracts/types': { title: 'Types', status: 'done', tags: ['foundation'] },
      'contracts/api':   { title: 'API', status: 'not_started', depends_on: ['contracts/types'], tags: ['foundation'] },
      'impl/core':       { title: 'Core', status: 'not_started', depends_on: ['contracts/types'], tags: ['core'] },
      'impl/extra':      { title: 'Extra', status: 'not_started', depends_on: ['impl/core'], tags: ['core'] },
    });
    tmpDir = project.tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('chunks returns coherent chunk data', () => {
    const t = new Trellis(tmpDir);
    const result = t.chunks();

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(Array.isArray(result.crossChunkEdges)).toBe(true);
    expect(typeof result.config.maxLines).toBe('number');

    // Every plan should appear in exactly one chunk
    const allPlanIds = result.chunks.flatMap(c => c.plans.map(p => p.id)).sort();
    expect(allPlanIds).toEqual(['contracts/api', 'contracts/types', 'impl/core', 'impl/extra']);
  });

  it('status filters by tag', () => {
    const t = new Trellis(tmpDir);

    const coreOnly = t.status({ tag: 'core', showDone: true });
    expect(coreOnly.total).toBe(2);
    expect(coreOnly.byStatus.ready.length + coreOnly.byStatus.blocked.length +
           coreOnly.byStatus.inProgress.length + coreOnly.byStatus.done.length +
           coreOnly.byStatus.draft.length + coreOnly.byStatus.archived.length).toBe(2);

    const foundationOnly = t.ready({ tag: 'foundation' });
    expect(foundationOnly.plans.every(p => p.tags.includes('foundation'))).toBe(true);
  });
});
```

describe('Consumer workflow: directory-based plans with contracts', () => {
  // Directory-based plans (id/README.md with inputs.md + outputs.md) are the primary
  // structure for complex plans. This test validates the Trellis API handles them correctly.

  function createDirProject() {
    const tmpDir = join(tmpdir(), `trellis-dir-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const plansDir = join(tmpDir, 'plans');
    writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');

    // Directory-based plan with contracts
    mkdirSync(join(plansDir, 'contracts', 'core-types'), { recursive: true });
    writeFileSync(join(plansDir, 'contracts', 'core-types', 'README.md'),
      '---\ntitle: Core Types\nstatus: done\ntags:\n  - foundation\n---\n\nDefine core type system.\n');
    writeFileSync(join(plansDir, 'contracts', 'core-types', 'outputs.md'),
      '## Type definitions\n- `Plan` interface\n- `PlanStatus` union type\n- `TrellisConfig` interface\n');

    // Downstream plan that references core-types via inputs
    mkdirSync(join(plansDir, 'impl', 'scanner'), { recursive: true });
    writeFileSync(join(plansDir, 'impl', 'scanner', 'README.md'),
      '---\ntitle: Scanner Implementation\nstatus: not_started\ndepends_on:\n  - contracts/core-types\ntags:\n  - core\n---\n\nImplement plan scanner.\n');
    writeFileSync(join(plansDir, 'impl', 'scanner', 'inputs.md'),
      '## From plans\n### contracts/core-types\n- `Plan` interface for scan results\n- `TrellisConfig` for directory resolution\n');
    writeFileSync(join(plansDir, 'impl', 'scanner', 'outputs.md'),
      '## Scanner module\n- `scanPlans()` function\n- `loadConfig()` function\n');

    // Simple file-based plan (no contracts)
    writeFileSync(join(plansDir, 'docs.md'),
      '---\ntitle: Documentation\nstatus: draft\n---\n\nWrite docs.\n');

    return { tmpDir, plansDir };
  }

  it('show() returns contract data for directory-based plans', () => {
    const { tmpDir } = createDirProject();
    try {
      const t = new Trellis(tmpDir);

      const coreTypes = t.show('contracts/core-types')!;
      expect(coreTypes).not.toBeNull();
      expect(coreTypes.outputs).not.toBeNull();
      expect(coreTypes.outputs!.length).toBeGreaterThan(0);
      expect(coreTypes.outputs![0].heading).toContain('Type definitions');

      const scanner = t.show('impl/scanner')!;
      expect(scanner).not.toBeNull();
      expect(scanner.inputs).not.toBeNull();
      expect(scanner.outputs).not.toBeNull();
      expect(scanner.dependsOn).toHaveLength(1);
      expect(scanner.dependsOn[0].id).toBe('contracts/core-types');
      expect(scanner.dependsOn[0].satisfied).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('graph() includes contract content on nodes', () => {
    const { tmpDir } = createDirProject();
    try {
      const t = new Trellis(tmpDir);
      const graph = t.graph();

      const coreNode = graph.nodes.find(n => n.id === 'contracts/core-types')!;
      expect(coreNode.outputs).toBeDefined();
      expect(coreNode.outputs).toContain('Type definitions');

      const scannerNode = graph.nodes.find(n => n.id === 'impl/scanner')!;
      expect(scannerNode.inputs).toBeDefined();
      expect(scannerNode.inputs).toContain('contracts/core-types');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('lint() reports contract-related warnings', () => {
    const tmpDir = join(tmpdir(), `trellis-lint-contracts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const plansDir = join(tmpDir, 'plans');
    writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');

    // Plan with dependents but no outputs.md
    mkdirSync(join(plansDir, 'upstream'), { recursive: true });
    writeFileSync(join(plansDir, 'upstream', 'README.md'),
      '---\ntitle: Upstream\nstatus: done\n---\n\nNo outputs defined.\n');

    // Downstream references upstream in inputs but upstream has no outputs
    mkdirSync(join(plansDir, 'downstream'), { recursive: true });
    writeFileSync(join(plansDir, 'downstream', 'README.md'),
      '---\ntitle: Downstream\nstatus: not_started\ndepends_on:\n  - upstream\n---\n\nNeeds upstream.\n');
    writeFileSync(join(plansDir, 'downstream', 'inputs.md'),
      '## From plans\n### upstream\n- Some deliverable\n');

    try {
      const t = new Trellis(tmpDir);
      const lint = t.lint();

      // Should warn about missing outputs on upstream (it has dependents)
      expect(lint.warnings.some(w => w.type === 'missing_outputs' && w.planId === 'upstream')).toBe(true);
      // Should warn about referencing upstream which has no outputs
      expect(lint.warnings.some(w => w.type === 'missing_upstream_outputs' && w.planId === 'downstream')).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Consumer workflow: concurrent Trellis instances', () => {
  it('two instances on same directory stay consistent after update', () => {
    const { tmpDir } = createTestProject({
      'a': { title: 'A', status: 'not_started' },
      'b': { title: 'B', status: 'not_started', depends_on: ['a'] },
    });
    try {
      const t1 = new Trellis(tmpDir);
      const t2 = new Trellis(tmpDir);

      // Both see the same initial state
      expect(t1.status().total).toBe(2);
      expect(t2.status().total).toBe(2);

      // Update via t1
      t1.update('a', 'done');

      // t2 still sees stale state until refresh
      const stale = t2.show('a')!;
      expect(stale.status).toBe('not_started');

      // After refresh, t2 sees the update
      t2.refresh();
      const fresh = t2.show('a')!;
      expect(fresh.status).toBe('done');
      expect(t2.ready().plans.map(p => p.id)).toContain('b');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

**Step 2: Run tests**

Run: `npm test -- tests/api-integration.test.ts`
Expected: PASS

**Step 3: Run full suite**

Run: `npm test`
Expected: All PASS

**Step 4: Commit**

```bash
git add tests/api-integration.test.ts
git commit -m "test: add consumer workflow integration tests for library API"
```
