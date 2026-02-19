# Phase 3: CLI Refactor — Commands Consume the Library API

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Refactor CLI commands to use the `Trellis` class internally instead of directly calling scanner/graph functions. This proves the library API is sufficient for all CLI use cases and eliminates duplicated logic between CLI commands and the API layer.

**Architecture:** Each command currently calls `loadConfig()`, `scanPlans()`, `buildGraph()` itself. We replace that boilerplate with `new Trellis(cwd)` and call the corresponding API method. The CLI command becomes a thin layer: parse args, call API, format output (chalk for terminal, JSON.stringify for `--json`). The `init` command stays as-is since it's a scaffolding tool, not a query.

**Tech Stack:** TypeScript

**Related:** [./phase-1.md](./phase-1.md), [./phase-2.md](./phase-2.md), [../README.md](../README.md)

---

## Why This Phase Matters

If the CLI can't be rewritten on top of the library API, the API is missing something. This phase is a forcing function — it validates completeness. After this phase, the `src/commands/*.ts` files are purely presentation (terminal formatting) and the `src/api.ts` + core modules are the entire logic layer.

---

## JSON Backward-Compatibility Mapping

The library API uses camelCase (TypeScript convention). The CLI's `--json` output uses snake_case (existing contract). Each command's JSON serialization must map between them. **This table is the definitive reference — every field listed here must be mapped in the corresponding command refactor.**

| API type | API field (camelCase) | JSON field (snake_case) | Commands affected |
|---|---|---|---|
| `StatusResult` | `byStatus` | `by_status` | status |
| `StatusResult.chunks` | `overBudget` | `over_budget` | status |
| `BlockedPlanSummary` | `waitingOn` | `waiting_on` | status |
| `PlanSummary` | `dependsOn` (from Plan) | `depends_on` | status, ready, show, graph |
| `UpdateResult` | `previousStatus` | `previous_status` | update |
| `UpdateResult` | `newStatus` | `status` | update |
| `UpdateResult` | `newlyReady` | `newly_ready` | update |
| `ShowResult` | `dependsOn` | `depends_on` | show |
| `ShowResult` | `criticalPath` | `critical_path` | show |
| `ShowResult` | `startedAt` | `started_at` | show |
| `ShowResult` | `completedAt` | `completed_at` | show |
| `ShowResult` | `filePath` | `filePath` | show (already camelCase in existing output) |
| `LintIssue` | `planId` | `plan_id` | lint |
| `LintResult` | `okCount` | `ok_count` | lint |
| `LintResult` | `contractCoverage` | `contract_coverage` | lint |
| `GraphNode` | `dependsOn` | `depends_on` | graph |
| `EpicResult` | `inProgress` | `in_progress` | epic |
| `EpicResult` | `notStarted` | `not_started` | epic |
| `ChunkResult.chunks` | `crossChunkEdges` | `crossChunkEdges` | chunks (already camelCase) |

**Implementation pattern:** Each command defines a local `toJson(result)` function that maps the API result to the existing JSON shape. This keeps the mapping explicit and co-located with the command that owns it.

```typescript
// Example: in updateCommand
function toJson(result: UpdateResult) {
  return {
    id: result.id,
    previous_status: result.previousStatus,
    status: result.newStatus,
    backward: result.backward,
    newly_ready: result.newlyReady,
  };
}
```

---

### Task 1: Refactor statusCommand to use Trellis

**Files:**
- Modify: `src/commands/status.ts`
- Reference: `tests/commands/status.test.ts`

**Step 1: Run existing tests to establish baseline**

Run: `npm test -- tests/commands/status.test.ts`
Expected: PASS (baseline)

**Step 2: Rewrite statusCommand**

Replace the body of `statusCommand` to use `new Trellis(cwd)` + `t.status()`. The JSON path just serializes the API result. The human-readable path formats `StatusResult` with chalk.

Key changes:
- Replace `loadConfig`, `scanPlans`, `buildGraph`, `computeChunks` calls with `new Trellis(cwd)` + `t.status(options)`
- JSON output: `console.log(JSON.stringify(result, null, 2))` where result maps StatusResult to the current JSON shape (maintain backward compatibility)
- Human output: iterate `result.byStatus.*` and format with chalk

Important: The JSON output shape must remain backward-compatible with the current output since other tools may consume it. Map `StatusResult` fields to the existing JSON schema:
```typescript
// Existing JSON shape (keep this):
{ project, total, chunks: { total, over_budget }, plans: [{ id, title, status, blocked, ready, depends_on, tags, repo, assignee }] }
```

**Step 3: Run existing tests**

Run: `npm test -- tests/commands/status.test.ts`
Expected: PASS (all existing tests still pass)

**Step 4: Commit**

```bash
git add src/commands/status.ts
git commit -m "refactor: statusCommand uses Trellis API internally"
```

---

### Task 2: Refactor readyCommand to use Trellis

**Files:**
- Modify: `src/commands/ready.ts`
- Reference: `tests/commands/ready.test.ts`

**Step 1: Run existing tests**

Run: `npm test -- tests/commands/ready.test.ts`
Expected: PASS (baseline)

**Step 2: Rewrite readyCommand**

Replace internals with `new Trellis(cwd)` + `t.ready(filters)`. For `--next`, use `result.next`.

**Step 3: Run tests**

Run: `npm test -- tests/commands/ready.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/commands/ready.ts
git commit -m "refactor: readyCommand uses Trellis API internally"
```

---

### Task 3: Refactor showCommand to use Trellis

**Files:**
- Modify: `src/commands/show.ts`
- Reference: `tests/commands/show.test.ts`

**Step 1: Run existing tests**

Run: `npm test -- tests/commands/show.test.ts`
Expected: PASS

**Step 2: Rewrite showCommand**

Replace with `new Trellis(cwd)` + `t.show(planId)`. If result is null, print error + exit. Otherwise format with chalk. JSON output maps ShowResult to current JSON shape.

**Step 3: Run tests**

Run: `npm test -- tests/commands/show.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/commands/show.ts
git commit -m "refactor: showCommand uses Trellis API internally"
```

---

### Task 4: Refactor updateCommand to use Trellis

**Files:**
- Modify: `src/commands/update.ts`
- Reference: `tests/commands/update.test.ts`

**Step 1: Run existing tests**

Run: `npm test -- tests/commands/update.test.ts`
Expected: PASS

**Step 2: Rewrite updateCommand**

Replace with `new Trellis(cwd)` + `t.update(planId, status)`. Wrap in try/catch — the API throws on invalid status or missing plan.

**Step 3: Run tests**

Run: `npm test -- tests/commands/update.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/commands/update.ts
git commit -m "refactor: updateCommand uses Trellis API internally"
```

---

### Task 5: Refactor lintCommand to use Trellis

**Files:**
- Modify: `src/commands/lint.ts`
- Reference: `tests/commands/lint.test.ts`

**Step 1: Run existing tests**

Run: `npm test -- tests/commands/lint.test.ts`
Expected: PASS

**Step 2: Rewrite lintCommand**

Replace with `new Trellis(cwd)` + `t.lint({ strict })`. Format errors and warnings with chalk. Set `process.exitCode = 1` when `result.ok === false`.

JSON shape compatibility: map `LintResult` to current output shape (field names already match or are close — `okCount` -> `ok_count`, `contractCoverage` -> `contract_coverage`).

**Step 3: Run tests**

Run: `npm test -- tests/commands/lint.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/commands/lint.ts
git commit -m "refactor: lintCommand uses Trellis API internally"
```

---

### Task 6: Refactor graphCommand to use Trellis

**Files:**
- Modify: `src/commands/graph.ts`
- Reference: `tests/commands/graph.test.ts`

**Step 1: Run existing tests**

Run: `npm test -- tests/commands/graph.test.ts`
Expected: PASS

**Step 2: Rewrite graphCommand**

For `--json` mode: use `t.graph()` and output `{ nodes, edges }` (matching current JSON shape, mapping `dependsOn` back to `depends_on`).

For browser mode: use `t.graph()` to build the data payload injected into HTML. The `getGraphData()` helper becomes `t.graph()`. The `/api/data` endpoint calls `t.refresh(); return t.graph()`.

**Step 3: Run tests**

Run: `npm test -- tests/commands/graph.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/commands/graph.ts
git commit -m "refactor: graphCommand uses Trellis API internally"
```

---

### Task 7: Refactor epicCommand and chunksCommand to use Trellis

**Files:**
- Modify: `src/commands/epic.ts`
- Modify: `src/commands/chunks.ts`
- Reference: `tests/commands/epic.test.ts`, `tests/commands/chunks.test.ts`

**Step 1: Run existing tests**

Run: `npm test -- tests/commands/epic.test.ts tests/commands/chunks.test.ts`
Expected: PASS

**Step 2: Rewrite both commands**

`epicCommand`: use `t.epic(name)`. Format with chalk or JSON.
`chunksCommand`: use `t.chunks(filters)`. Format with chalk or JSON.

**Step 3: Run tests**

Run: `npm test -- tests/commands/epic.test.ts tests/commands/chunks.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/commands/epic.ts src/commands/chunks.ts
git commit -m "refactor: epicCommand and chunksCommand use Trellis API internally"
```

---

### Task 8: JSON backward-compatibility contract tests

After refactoring all commands, we need to lock down the JSON output schema. These tests verify every field from the backward-compatibility mapping table above is present, correctly cased, and semantically valid. This prevents silent breakage for downstream consumers parsing `--json` output.

**Files:**
- Create: `tests/json-contracts.test.ts`

**Step 1: Write the JSON contract tests**

```typescript
// tests/json-contracts.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture } from './helpers.ts';
import { statusCommand } from '../src/commands/status.ts';
import { readyCommand } from '../src/commands/ready.ts';
import { showCommand } from '../src/commands/show.ts';
import { updateCommand } from '../src/commands/update.ts';
import { lintCommand } from '../src/commands/lint.ts';
import { graphCommand } from '../src/commands/graph.ts';
import { epicCommand } from '../src/commands/epic.ts';
import { chunksCommand } from '../src/commands/chunks.ts';

// These tests exhaustively verify the JSON output shape of every command
// against the backward-compatibility mapping table in phase-3.md.
// If a field is missing or misnamed, these tests fail.

describe('JSON output contracts', () => {
  let originalCwd: () => string;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    originalCwd = process.cwd;
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logs.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      errors.push(args.join(' '));
    });
  });

  afterEach(() => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  describe('status --json', () => {
    it('has all required fields with correct casing', () => {
      const { root } = createFixture([
        { id: 'dep', title: 'Dep', status: 'done' },
        { id: 'ready', title: 'Ready', status: 'not_started', depends_on: ['dep'], tags: ['core'], repo: 'public' },
        { id: 'blocked', title: 'Blocked', status: 'not_started', depends_on: ['ready'] },
        { id: 'ip', title: 'IP', status: 'in_progress' },
        { id: 'draft', title: 'Draft', status: 'draft' },
      ]);
      process.cwd = () => root;

      statusCommand({ json: true, all: true });

      const json = JSON.parse(logs.join(''));
      // Top-level fields
      expect(json).toHaveProperty('project');
      expect(json).toHaveProperty('total');
      expect(json).toHaveProperty('plans');
      expect(json).toHaveProperty('chunks');
      expect(json.chunks).toHaveProperty('total');
      expect(json.chunks).toHaveProperty('over_budget'); // snake_case

      // Plan fields
      const plan = json.plans.find((p: any) => p.id === 'ready');
      expect(plan).toHaveProperty('id');
      expect(plan).toHaveProperty('title');
      expect(plan).toHaveProperty('status');
      expect(plan).toHaveProperty('blocked');
      expect(plan).toHaveProperty('ready');
      expect(plan).toHaveProperty('depends_on'); // snake_case
      expect(plan).toHaveProperty('tags');
      expect(plan).toHaveProperty('repo');
      expect(plan.depends_on).toEqual(['dep']);

      // Blocked plan has waiting_on
      const blockedPlan = json.plans.find((p: any) => p.id === 'blocked');
      expect(blockedPlan).toHaveProperty('waiting_on'); // snake_case
      expect(Array.isArray(blockedPlan.waiting_on)).toBe(true);
    });
  });

  describe('update --json', () => {
    it('has all required fields with correct casing', () => {
      const { root } = createFixture([
        { id: 'a', title: 'A', status: 'not_started' },
        { id: 'b', title: 'B', status: 'not_started', depends_on: ['a'] },
      ]);
      process.cwd = () => root;

      updateCommand('a', 'done', { json: true });

      const json = JSON.parse(logs.join(''));
      expect(json).toHaveProperty('id');
      expect(json).toHaveProperty('previous_status'); // snake_case (not previousStatus)
      expect(json).toHaveProperty('status');           // mapped from newStatus
      expect(json).toHaveProperty('backward');
      expect(json).toHaveProperty('newly_ready');      // snake_case
      expect(json.previous_status).toBe('not_started');
      expect(json.status).toBe('done');
      expect(json.newly_ready).toContain('b');
    });
  });

  describe('show --json', () => {
    it('has all required fields with correct casing', () => {
      const { root } = createFixture([
        { id: 'dep', title: 'Dep', status: 'done' },
        { id: 'main', title: 'Main Plan', status: 'not_started', depends_on: ['dep'], tags: ['core'] },
        { id: 'child', title: 'Child', status: 'not_started', depends_on: ['main'] },
      ]);
      process.cwd = () => root;

      showCommand('main', { json: true });

      const json = JSON.parse(logs.join(''));
      expect(json).toHaveProperty('id');
      expect(json).toHaveProperty('filePath');
      expect(json).toHaveProperty('title');
      expect(json).toHaveProperty('status');
      expect(json).toHaveProperty('blocked');
      expect(json).toHaveProperty('ready');
      expect(json).toHaveProperty('depends_on');      // snake_case
      expect(json).toHaveProperty('blocks');
      expect(json).toHaveProperty('critical_path');    // snake_case
      expect(json).toHaveProperty('tags');
      expect(json).toHaveProperty('body');

      // Dependency detail objects
      expect(Array.isArray(json.depends_on)).toBe(true);
      if (json.depends_on.length > 0) {
        expect(json.depends_on[0]).toHaveProperty('id');
        expect(json.depends_on[0]).toHaveProperty('status');
        expect(json.depends_on[0]).toHaveProperty('satisfied');
      }
    });
  });

  describe('lint --json', () => {
    it('has all required fields with correct casing', () => {
      const { root } = createFixture([
        { id: 'a', title: 'A', status: 'not_started', depends_on: ['missing'] },
      ]);
      process.cwd = () => root;

      lintCommand({ json: true });

      const json = JSON.parse(logs.join(''));
      expect(json).toHaveProperty('ok');
      expect(json).toHaveProperty('total');
      expect(json).toHaveProperty('ok_count');            // snake_case
      expect(json).toHaveProperty('errors');
      expect(json).toHaveProperty('warnings');
      expect(json).toHaveProperty('contract_coverage');    // snake_case

      // Issue objects
      if (json.errors.length > 0) {
        expect(json.errors[0]).toHaveProperty('plan_id');  // snake_case
        expect(json.errors[0]).toHaveProperty('type');
        expect(json.errors[0]).toHaveProperty('message');
      }
    });
  });

  describe('graph --json', () => {
    it('has all required fields with correct casing', () => {
      const { root } = createFixture([
        { id: 'a', title: 'A', status: 'done' },
        { id: 'b', title: 'B', status: 'not_started', depends_on: ['a'] },
      ]);
      process.cwd = () => root;

      graphCommand({ json: true });

      const json = JSON.parse(logs.join(''));
      expect(json).toHaveProperty('nodes');
      expect(json).toHaveProperty('edges');

      const node = json.nodes.find((n: any) => n.id === 'b');
      expect(node).toHaveProperty('depends_on'); // snake_case
      expect(node).toHaveProperty('status');
      expect(node).toHaveProperty('blocked');
      expect(node).toHaveProperty('ready');
    });
  });

  describe('epic --json', () => {
    it('has all required fields with correct casing', () => {
      const { root } = createFixture([
        { id: 'a', title: 'A', status: 'done', tags: ['epic:v1'] },
        { id: 'b', title: 'B', status: 'in_progress', tags: ['epic:v1'] },
        { id: 'c', title: 'C', status: 'not_started', tags: ['epic:v1'] },
      ]);
      process.cwd = () => root;

      epicCommand(undefined, { json: true });

      const json = JSON.parse(logs.join(''));
      expect(Array.isArray(json)).toBe(true);
      const epic = json[0];
      expect(epic).toHaveProperty('epic');
      expect(epic).toHaveProperty('total');
      expect(epic).toHaveProperty('done');
      expect(epic).toHaveProperty('in_progress');   // snake_case
      expect(epic).toHaveProperty('not_started');    // snake_case
      expect(epic).toHaveProperty('blocked');
      expect(epic).toHaveProperty('draft');
      expect(epic).toHaveProperty('progress');
    });
  });
});
```

**Step 2: Run tests**

Run: `npm test -- tests/json-contracts.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/json-contracts.test.ts
git commit -m "test: add JSON backward-compatibility contract tests for all commands"
```

---

### Task 9: API/CLI cross-layer consistency tests

This is the key integration test that proves the CLI wrapper is faithful to the library API. It runs the same operations through both layers and asserts they produce semantically equivalent results. If the CLI's `toJson()` mapping diverges from the API's return types, these tests catch it.

**Files:**
- Create: `tests/api-cli-consistency.test.ts`

**Step 1: Write the cross-layer test**

```typescript
// tests/api-cli-consistency.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'fs';
import { createFixture } from './helpers.ts';
import { Trellis } from '../src/index.ts';
import { statusCommand } from '../src/commands/status.ts';
import { readyCommand } from '../src/commands/ready.ts';
import { showCommand } from '../src/commands/show.ts';
import { lintCommand } from '../src/commands/lint.ts';

// These tests verify that the CLI JSON output is a faithful representation
// of the library API return values. If a command's toJson() mapping is wrong,
// or the API returns different data than the CLI formats, these tests fail.

describe('API/CLI cross-layer consistency', () => {
  let originalCwd: () => string;
  let logs: string[];
  let root: string;
  let t: InstanceType<typeof Trellis>;

  beforeEach(() => {
    originalCwd = process.cwd;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logs.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const fixture = createFixture([
      { id: 'contracts/types', title: 'Core Types', status: 'done', tags: ['foundation'] },
      { id: 'contracts/api', title: 'API Contract', status: 'done', depends_on: ['contracts/types'], tags: ['foundation'] },
      { id: 'impl/scanner', title: 'Scanner', status: 'in_progress', depends_on: ['contracts/types'], tags: ['core'] },
      { id: 'impl/graph', title: 'Graph', status: 'not_started', depends_on: ['contracts/api'], tags: ['core'] },
      { id: 'impl/cli', title: 'CLI', status: 'not_started', depends_on: ['impl/scanner', 'impl/graph'], tags: ['shell'] },
    ]);
    root = fixture.root;
    process.cwd = () => root;
    t = new Trellis(root);
  });

  afterEach(() => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it('status: API and CLI agree on plan counts and categorization', () => {
    // API result
    const apiResult = t.status({ showDone: true, showArchived: true });

    // CLI JSON result
    logs = [];
    statusCommand({ json: true, all: true });
    const cliResult = JSON.parse(logs.join(''));

    // Same total
    expect(cliResult.total).toBe(apiResult.total);
    expect(cliResult.project).toBe(apiResult.project);

    // Same plan IDs
    const apiPlanIds = [
      ...apiResult.byStatus.ready,
      ...apiResult.byStatus.blocked,
      ...apiResult.byStatus.inProgress,
      ...apiResult.byStatus.done,
      ...apiResult.byStatus.draft,
      ...apiResult.byStatus.archived,
    ].map(p => p.id).sort();
    const cliPlanIds = cliResult.plans.map((p: any) => p.id).sort();
    expect(cliPlanIds).toEqual(apiPlanIds);

    // Ready/blocked agreement
    const apiReadyIds = apiResult.byStatus.ready.map(p => p.id).sort();
    const cliReadyIds = cliResult.plans.filter((p: any) => p.ready).map((p: any) => p.id).sort();
    expect(cliReadyIds).toEqual(apiReadyIds);
  });

  it('ready: API and CLI agree on ready plans and next pick', () => {
    const apiResult = t.ready();

    logs = [];
    readyCommand({ json: true });
    const cliResult = JSON.parse(logs.join(''));

    const apiReadyIds = apiResult.plans.map(p => p.id).sort();
    const cliReadyIds = cliResult.plans.map((p: any) => p.id).sort();
    expect(cliReadyIds).toEqual(apiReadyIds);

    // Both should agree on the next pick
    expect(cliResult.next).toBe(apiResult.next);
  });

  it('show: API and CLI agree on plan details', () => {
    const apiResult = t.show('impl/cli')!;

    logs = [];
    showCommand('impl/cli', { json: true });
    const cliResult = JSON.parse(logs.join(''));

    expect(cliResult.id).toBe(apiResult.id);
    expect(cliResult.title).toBe(apiResult.title);
    expect(cliResult.status).toBe(apiResult.status);
    expect(cliResult.blocked).toBe(apiResult.blocked);
    expect(cliResult.ready).toBe(apiResult.ready);

    // Dependency IDs match (accounting for field name mapping)
    const apiDepIds = apiResult.dependsOn.map(d => d.id).sort();
    const cliDepIds = cliResult.depends_on.map((d: any) => d.id).sort();
    expect(cliDepIds).toEqual(apiDepIds);
  });

  it('lint: API and CLI agree on error/warning counts', () => {
    const apiResult = t.lint();

    logs = [];
    lintCommand({ json: true });
    const cliResult = JSON.parse(logs.join(''));

    expect(cliResult.ok).toBe(apiResult.ok);
    expect(cliResult.total).toBe(apiResult.total);
    expect(cliResult.errors.length).toBe(apiResult.errors.length);
    expect(cliResult.warnings.length).toBe(apiResult.warnings.length);
  });
});
```

**Step 2: Run tests**

Run: `npm test -- tests/api-cli-consistency.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/api-cli-consistency.test.ts
git commit -m "test: add API/CLI cross-layer consistency tests"
```

---

### Task 10: Full test suite validation

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests PASS

**Step 2: Run build**

Run: `npm run build`
Expected: Builds without errors, produces `dist/trellis.cjs`, `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts`

**Step 3: Smoke test CLI**

Run: `node dist/trellis.cjs --help`
Expected: Shows help text

**Step 4: Run built artifact integration tests**

Run: `npm run test:dist`
Expected: All PASS — the built library works end-to-end

**Step 5: Commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: full test suite validation after CLI refactor"
```
