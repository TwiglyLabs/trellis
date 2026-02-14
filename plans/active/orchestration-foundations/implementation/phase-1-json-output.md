# Phase 1: --json Flag on All Commands

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Add `--json` output to `ready`, `show`, `update`, `lint`, and `graph` commands, plus align the existing `status --json` schema. After this phase, every command supports structured output for orchestrator consumption.

**Architecture:** Each command already has an `options` parameter (except `show` and `update` which take positional args). Add a `json?: boolean` to options, and when set, `console.log(JSON.stringify(...))` instead of chalk output. Follow the exact pattern from `status.ts`.

**Tech Stack:** TypeScript, Vitest

**Related:** [./phase-2-ready-next.md](./phase-2-ready-next.md), [./phase-3-status-filtering.md](./phase-3-status-filtering.md), [./phase-4-epic-tracking.md](./phase-4-epic-tracking.md)

**Error convention:** All JSON errors go to `console.error` (stderr). All JSON data goes to `console.log` (stdout). This applies to every task below. See the [exit code contract](../README.md) for the full specification.

---

## Task 1: Add --json to `ready` command

**Files:**
- Modify: `tests/commands/ready.test.ts`
- Modify: `src/commands/ready.ts`
- Modify: `src/cli.ts`

**Step 1: Write the failing test**

Add to `tests/commands/ready.test.ts` inside the existing `describe` block:

```typescript
it('outputs JSON', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'done' },
    { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], tags: ['infra'], repo: 'public', description: 'B desc' },
    { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
  ]);
  process.cwd = () => root;

  readyCommand({ json: true });

  const parsed = JSON.parse(logs.join(''));
  expect(parsed).toHaveLength(1);
  expect(parsed[0].id).toBe('b');
  expect(parsed[0].title).toBe('Plan B');
  expect(parsed[0].depends_on).toEqual(['a']);
  expect(parsed[0].tags).toEqual(['infra']);
  expect(parsed[0].repo).toBe('public');
  expect(parsed[0].description).toBe('B desc');
});

it('outputs empty JSON array when no plans ready', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'in_progress' },
  ]);
  process.cwd = () => root;

  readyCommand({ json: true });

  const parsed = JSON.parse(logs.join(''));
  expect(parsed).toEqual([]);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/ready.test.ts`
Expected: FAIL — `readyCommand` doesn't accept `json` option.

**Step 3: Implement**

In `src/commands/ready.ts`, update the `ReadyOptions` interface and function:

```typescript
interface ReadyOptions {
  tag?: string;
  repo?: string;
  json?: boolean;
}

export function readyCommand(options: ReadyOptions): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);
  const graph = buildGraph(plans);

  let readyPlans = plans.filter(p => graph.ready.has(p.id));
  readyPlans = filterPlans(readyPlans, options);

  if (options.json) {
    const output = readyPlans.map(p => ({
      id: p.id,
      title: p.frontmatter.title,
      status: p.frontmatter.status,
      depends_on: p.frontmatter.depends_on ?? [],
      tags: p.frontmatter.tags ?? [],
      repo: p.frontmatter.repo,
      description: p.frontmatter.description,
      assignee: p.frontmatter.assignee,
    }));
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (readyPlans.length === 0) {
    console.log('No plans are ready.');
    return;
  }

  const idWidth = computeColumnWidth(readyPlans.map(p => p.id));

  for (const p of readyPlans) {
    const desc = p.frontmatter.description || p.frontmatter.title;
    const tags = p.frontmatter.repo ? `[${p.frontmatter.repo}]` : '';
    console.log(`${chalk.white(padRight(p.id, idWidth))} ${padRight(desc, 40)} ${chalk.dim(tags)}`);
  }
}
```

In `src/cli.ts`, add the `--json` option to the `ready` command:

```typescript
program
  .command('ready')
  .description('List plans with all dependencies satisfied')
  .option('--tag <tag>', 'Filter by tag')
  .option('--repo <repo>', 'Filter by repo')
  .option('--json', 'Output as JSON')
  .addHelpText('after', '\nExamples:\n  $ trellis ready\n  $ trellis ready --repo public\n  $ trellis ready --json')
  .action((options) => readyCommand(options));
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/ready.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/ready.ts src/cli.ts tests/commands/ready.test.ts
git commit -m "feat(ready): add --json output flag"
```

---

## Task 2: Add --json to `show` command

**Files:**
- Modify: `tests/commands/show.test.ts`
- Modify: `src/commands/show.ts`
- Modify: `src/cli.ts`

**Step 1: Write the failing test**

Add to `tests/commands/show.test.ts`:

```typescript
it('outputs JSON', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'done' },
    { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], tags: ['infra'], description: 'B desc' },
    { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
  ]);
  process.cwd = () => root;

  showCommand('b', { json: true });

  const parsed = JSON.parse(logs.join(''));
  expect(parsed.id).toBe('b');
  expect(parsed.title).toBe('Plan B');
  expect(parsed.status).toBe('not_started');
  expect(parsed.blocked).toBe(true);
  expect(parsed.ready).toBe(false);
  expect(parsed.depends_on).toEqual([{ id: 'a', status: 'done', satisfied: true }]);
  expect(parsed.blocks).toEqual(['c']);
  expect(parsed.critical_path).toEqual(['a', 'b']);
  expect(parsed.filePath).toContain('plans/b.md');
});

it('outputs JSON error for missing plan', () => {
  const { root } = createFixture([]);
  process.cwd = () => root;

  showCommand('nonexistent', { json: true });

  const parsed = JSON.parse(errors.join(''));
  expect(parsed.error).toContain('not found');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/show.test.ts`
Expected: FAIL — `showCommand` signature doesn't accept options.

**Step 3: Implement**

Update `src/commands/show.ts`. Change the signature to accept options:

```typescript
interface ShowOptions {
  json?: boolean;
}

export function showCommand(planId: string, options?: ShowOptions): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);
  const graph = buildGraph(plans);

  const plan = graph.plans.get(planId);
  if (!plan) {
    if (options?.json) {
      console.error(JSON.stringify({ error: `Plan "${planId}" not found.` }));
    } else {
      console.error(`Plan "${planId}" not found.`);
    }
    process.exitCode = 1;
    return;
  }

  const fm = plan.frontmatter;
  const isBlocked = graph.blocked.has(planId);
  const isReady = graph.ready.has(planId);
  const directDeps = graph.dependents.get(planId) ?? [];
  const transitive = transitiveDependents(planId, graph);
  const criticalPath = computeCriticalPath(planId, graph);

  if (options?.json) {
    const output = {
      id: planId,
      filePath: plan.filePath,
      title: fm.title,
      status: fm.status,
      blocked: isBlocked,
      ready: isReady,
      tags: fm.tags ?? [],
      repo: fm.repo,
      assignee: fm.assignee,
      description: fm.description,
      started_at: fm.started_at,
      completed_at: fm.completed_at,
      depends_on: (fm.depends_on ?? []).map(depId => {
        const dep = graph.plans.get(depId);
        return {
          id: depId,
          status: dep?.frontmatter.status ?? 'not_found',
          satisfied: dep ? dep.frontmatter.status === 'done' : false,
        };
      }),
      blocks: [...new Set([...directDeps, ...transitive])],
      critical_path: criticalPath,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // ... rest of existing human-readable output unchanged ...
```

Keep the entire existing human-readable output block after the JSON early return — don't change it.

In `src/cli.ts`, update the `show` command:

```typescript
program
  .command('show <plan-id>')
  .description('Show plan details and dependency chain')
  .option('--json', 'Output as JSON')
  .addHelpText('after', '\nExamples:\n  $ trellis show core-types\n  $ trellis show impl/parser\n  $ trellis show core-types --json')
  .action((planId, options) => showCommand(planId, options));
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/show.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/show.ts src/cli.ts tests/commands/show.test.ts
git commit -m "feat(show): add --json output flag"
```

---

## Task 3: Add --json to `update` command

**Files:**
- Modify: `tests/commands/update.test.ts`
- Modify: `src/commands/update.ts`
- Modify: `src/cli.ts`

**Step 1: Write the failing test**

Add to `tests/commands/update.test.ts`:

```typescript
it('outputs JSON on success', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'not_started' },
    { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
  ]);
  process.cwd = () => root;

  updateCommand('a', 'done', { json: true });

  const parsed = JSON.parse(logs.join(''));
  expect(parsed.id).toBe('a');
  expect(parsed.previous_status).toBe('not_started');
  expect(parsed.status).toBe('done');
  expect(parsed.newly_ready).toEqual(['b']);
});

it('outputs JSON error on invalid status', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'not_started' },
  ]);
  process.cwd = () => root;

  updateCommand('a', 'invalid', { json: true });

  const parsed = JSON.parse(errors.join(''));
  expect(parsed.error).toContain('Invalid status');
});

it('outputs JSON error on missing plan', () => {
  const { root } = createFixture([]);
  process.cwd = () => root;

  updateCommand('nonexistent', 'done', { json: true });

  const parsed = JSON.parse(errors.join(''));
  expect(parsed.error).toContain('not found');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/update.test.ts`
Expected: FAIL — `updateCommand` doesn't accept options.

**Step 3: Implement**

Update `src/commands/update.ts`. Change the signature to accept options:

```typescript
interface UpdateOptions {
  json?: boolean;
}

export function updateCommand(planId: string, status: string, options?: UpdateOptions): void {
  if (!VALID_STATUSES.includes(status as PlanStatus)) {
    if (options?.json) {
      console.error(JSON.stringify({ error: `Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}` }));
    } else {
      console.error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);
  const graph = buildGraph(plans);

  const plan = graph.plans.get(planId);
  if (!plan) {
    if (options?.json) {
      console.error(JSON.stringify({ error: `Plan "${planId}" not found.` }));
    } else {
      console.error(`Plan "${planId}" not found.`);
    }
    process.exitCode = 1;
    return;
  }

  const previousStatus = plan.frontmatter.status;
  const oldOrder = STATUS_ORDER[previousStatus] ?? 0;
  const newOrder = STATUS_ORDER[status] ?? 0;
  const deleteFields: string[] = [];

  if (newOrder < oldOrder) {
    if (!options?.json) {
      console.log(chalk.yellow(`⚠ Moving ${planId} backward: ${previousStatus} → ${status}`));
    }
    if (newOrder < STATUS_ORDER.in_progress && plan.frontmatter.started_at) {
      deleteFields.push('started_at');
    }
    if (newOrder < STATUS_ORDER.done && plan.frontmatter.completed_at) {
      deleteFields.push('completed_at');
    }
  }

  const updates: Partial<PlanFrontmatter> = { status: status as PlanStatus };

  if (status === 'in_progress' && !plan.frontmatter.started_at) {
    updates.started_at = new Date().toISOString();
  }
  if (status === 'done' && !plan.frontmatter.completed_at) {
    updates.completed_at = new Date().toISOString();
  }

  updatePlanFile(plan.filePath, updates, deleteFields.length > 0 ? deleteFields : undefined);

  const ready = newlyReady(planId, status, graph);

  if (options?.json) {
    const output = {
      id: planId,
      previous_status: previousStatus,
      status,
      backward: newOrder < oldOrder,
      newly_ready: ready,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`${chalk.green('✓')} ${planId} → ${status}`);

  if (ready.length > 0) {
    const idWidth = computeColumnWidth(ready);
    console.log(`\n  Now ready:`);
    for (const id of ready) {
      const readyPlan = graph.plans.get(id)!;
      console.log(`    ${chalk.white(padRight(id, idWidth))} ${readyPlan.frontmatter.title}`);
    }
  }
}
```

In `src/cli.ts`, update the `update` command:

```typescript
program
  .command('update <plan-id> <status>')
  .description('Edit frontmatter in-place, show what unblocks')
  .option('--json', 'Output as JSON')
  .addHelpText('after', '\nExamples:\n  $ trellis update core-types in_progress\n  $ trellis update impl/parser done\n  $ trellis update core-types done --json')
  .action((planId, status, options) => updateCommand(planId, status, options));
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/update.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/update.ts src/cli.ts tests/commands/update.test.ts
git commit -m "feat(update): add --json output flag"
```

---

## Task 4: Add --json to `lint` command

**Files:**
- Modify: `tests/commands/lint.test.ts`
- Modify: `src/commands/lint.ts`
- Modify: `src/cli.ts`

**Step 1: Write the failing test**

Add to `tests/commands/lint.test.ts`:

```typescript
it('outputs JSON with errors and warnings', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'not_started', depends_on: ['nonexistent'] },
    { id: 'b', title: 'Plan B', status: 'draft' },
    { id: 'c', title: 'Plan C', status: 'done' },
  ]);
  process.cwd = () => root;

  lintCommand({ json: true });

  const parsed = JSON.parse(logs.join(''));
  expect(parsed.ok).toBe(false);
  expect(parsed.total).toBe(3);
  expect(parsed.errors.length).toBeGreaterThan(0);
  expect(parsed.warnings.length).toBeGreaterThan(0);
  expect(parsed.errors[0]).toHaveProperty('plan_id');
  expect(parsed.errors[0]).toHaveProperty('type');
  expect(parsed.errors[0]).toHaveProperty('message');
});

it('outputs clean JSON when no issues', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'done' },
    { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
  ]);
  process.cwd = () => root;

  lintCommand({ json: true });

  const parsed = JSON.parse(logs.join(''));
  expect(parsed.ok).toBe(true);
  expect(parsed.errors).toEqual([]);
  expect(parsed.warnings).toEqual([]);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/lint.test.ts`
Expected: FAIL — `lintCommand` doesn't handle `json` option.

**Step 3: Implement**

Update `src/commands/lint.ts`. **Important: this is a refactor, not a rewrite.** The key insight: collect errors and warnings into arrays instead of printing inline, then either print them or JSON-serialize them at the end. Preserve all existing check logic exactly — cycle detection, missing deps, frontmatter validation, done-with-incomplete-deps, in-progress warnings, orphan detection. The code below shows the target structure; verify each check matches the current implementation before replacing.

```typescript
interface LintResult {
  plan_id: string;
  type: string;
  message: string;
}

export function lintCommand(options?: { strict?: boolean; json?: boolean }): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);

  if (plans.length === 0) {
    if (options?.json) {
      console.log(JSON.stringify({ ok: true, total: 0, errors: [], warnings: [] }));
    } else {
      console.log('No plans found.');
    }
    return;
  }

  const planIds = new Set(plans.map(p => p.id));
  const plansWithErrors = new Set<string>();
  const errors: LintResult[] = [];
  const warnings: LintResult[] = [];

  // Cycle detection
  const cycles = detectCycles(plans);
  for (const cycle of cycles) {
    errors.push({ plan_id: cycle.path[0], type: 'cycle', message: `Cycle detected: ${cycle.path.join(' → ')}` });
    for (let i = 0; i < cycle.path.length - 1; i++) {
      plansWithErrors.add(cycle.path[i]);
    }
  }

  // Missing dependencies
  for (const plan of plans) {
    for (const dep of plan.frontmatter.depends_on ?? []) {
      if (!planIds.has(dep)) {
        errors.push({ plan_id: plan.id, type: 'missing_dependency', message: `Unknown dependency: ${plan.id} depends on "${dep}"` });
        plansWithErrors.add(plan.id);
      }
    }
  }

  // Frontmatter validation
  for (const plan of plans) {
    const fmErrors = validateFrontmatter(plan.id, plan.frontmatter);
    for (const error of fmErrors) {
      errors.push({ plan_id: plan.id, type: 'frontmatter', message: `${plan.id}: ${error.message}` });
      plansWithErrors.add(plan.id);
    }
  }

  // Inconsistencies: done plans with incomplete deps
  for (const plan of plans) {
    if (plan.frontmatter.status === 'done') {
      for (const dep of plan.frontmatter.depends_on ?? []) {
        const depPlan = plans.find(p => p.id === dep);
        if (depPlan && depPlan.frontmatter.status !== 'done') {
          errors.push({ plan_id: plan.id, type: 'inconsistency', message: `${plan.id} is done but depends on ${dep} (${depPlan.frontmatter.status})` });
          plansWithErrors.add(plan.id);
        }
      }
    }
  }

  // Warning: in_progress with incomplete deps
  for (const plan of plans) {
    if (plan.frontmatter.status === 'in_progress') {
      for (const dep of plan.frontmatter.depends_on ?? []) {
        const depPlan = plans.find(p => p.id === dep);
        if (depPlan && depPlan.frontmatter.status !== 'done') {
          warnings.push({ plan_id: plan.id, type: 'incomplete_deps', message: `${plan.id} is in_progress but depends on ${dep} (${depPlan.frontmatter.status})` });
        }
      }
    }
  }

  // Orphan detection
  const dependedOn = new Set<string>();
  for (const plan of plans) {
    for (const dep of plan.frontmatter.depends_on ?? []) {
      dependedOn.add(dep);
    }
  }
  for (const plan of plans) {
    if (plan.frontmatter.status === 'draft' && !dependedOn.has(plan.id)) {
      warnings.push({ plan_id: plan.id, type: 'orphan', message: `Orphaned plan: ${plan.id} has no dependents and status is draft` });
    }
  }

  if (options?.json) {
    console.log(JSON.stringify({
      ok: errors.length === 0 && (options?.strict ? warnings.length === 0 : true),
      total: plans.length,
      ok_count: plans.length - plansWithErrors.size,
      errors,
      warnings,
    }, null, 2));
  } else {
    for (const e of errors) {
      console.log(`${chalk.red('✗')} ${e.message}`);
    }
    for (const w of warnings) {
      console.log(`${chalk.yellow('⚠')} ${w.message}`);
    }

    const okCount = plans.length - plansWithErrors.size;
    if (errors.length === 0 && warnings.length === 0) {
      console.log(`${chalk.green('✓')} ${plans.length} plans OK`);
    } else {
      console.log(`${chalk.green('✓')} ${okCount} of ${plans.length} plans OK`);
    }
  }

  if (errors.length > 0) {
    process.exitCode = 1;
  }

  if (options?.strict && warnings.length > 0) {
    process.exitCode = 1;
  }
}
```

In `src/cli.ts`, add `--json` to the lint command:

```typescript
program
  .command('lint')
  .description('Find cycles, missing deps, bad frontmatter')
  .option('--strict', 'Exit with error on warnings too')
  .option('--json', 'Output as JSON')
  .addHelpText('after', '\nExamples:\n  $ trellis lint\n  $ trellis lint --strict\n  $ trellis lint --json')
  .action((options) => lintCommand(options));
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/lint.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All 104+ tests pass (existing tests should not break — the human-readable code paths are unchanged).

**Step 6: Commit**

```bash
git add src/commands/lint.ts src/cli.ts tests/commands/lint.test.ts
git commit -m "feat(lint): add --json output flag"
```

---

## Task 5: Align `status --json` schema

The existing `status --json` output is missing `assignee` (all other commands include it). Fix the inconsistency.

**Files:**
- Modify: `tests/commands/status.test.ts`
- Modify: `src/commands/status.ts`

**Step 1: Write the failing test**

Add to `tests/commands/status.test.ts`:

```typescript
it('includes assignee in JSON output', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'in_progress', assignee: 'agent-1' },
  ]);
  process.cwd = () => root;

  statusCommand({ json: true });

  const parsed = JSON.parse(logs.join(''));
  expect(parsed.plans[0].assignee).toBe('agent-1');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/status.test.ts`
Expected: FAIL — `assignee` not in output.

**Step 3: Implement**

In the `status --json` output mapping (inside `statusCommand`), add `assignee`:

```typescript
plans: filtered.map(p => ({
  id: p.id,
  title: p.frontmatter.title,
  status: p.frontmatter.status,
  blocked: graph.blocked.has(p.id),
  ready: graph.ready.has(p.id),
  depends_on: p.frontmatter.depends_on ?? [],
  tags: p.frontmatter.tags ?? [],
  repo: p.frontmatter.repo,
  assignee: p.frontmatter.assignee,
})),
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/status.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/status.ts tests/commands/status.test.ts
git commit -m "feat(status): add assignee to --json output for schema consistency"
```

---

## Task 6: Add `graph --json` for DAG export

This is the most useful orchestration primitive — export the full dependency graph as structured data without launching a browser.

**Files:**
- Modify: `tests/commands/graph.test.ts`
- Modify: `src/commands/graph.ts`
- Modify: `src/cli.ts`

**Step 1: Write the failing test**

Add to `tests/commands/graph.test.ts`:

```typescript
it('outputs JSON DAG', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'done' },
    { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], tags: ['infra'] },
    { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
  ]);
  process.cwd = () => root;

  graphCommand({ json: true });

  const parsed = JSON.parse(logs.join(''));
  expect(parsed.nodes).toHaveLength(3);
  expect(parsed.edges).toHaveLength(2);

  const nodeB = parsed.nodes.find((n: any) => n.id === 'b');
  expect(nodeB.title).toBe('Plan B');
  expect(nodeB.status).toBe('not_started');
  expect(nodeB.blocked).toBe(false);
  expect(nodeB.ready).toBe(true);
  expect(nodeB.tags).toEqual(['infra']);

  expect(parsed.edges).toContainEqual({ from: 'a', to: 'b' });
  expect(parsed.edges).toContainEqual({ from: 'b', to: 'c' });
});

it('outputs empty JSON DAG when no plans', () => {
  const { root } = createFixture([]);
  process.cwd = () => root;

  graphCommand({ json: true });

  const parsed = JSON.parse(logs.join(''));
  expect(parsed.nodes).toEqual([]);
  expect(parsed.edges).toEqual([]);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/graph.test.ts`
Expected: FAIL — `graphCommand` doesn't handle `json` option.

**Step 3: Implement**

In `src/commands/graph.ts`, add the `--json` path **before** the HTTP server logic (early return):

```typescript
interface GraphOptions {
  port?: number;
  json?: boolean;
}

export function graphCommand(options: GraphOptions): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);
  const graph = buildGraph(plans);

  if (options.json) {
    const nodes = plans.map(p => ({
      id: p.id,
      title: p.frontmatter.title,
      status: p.frontmatter.status,
      blocked: graph.blocked.has(p.id),
      ready: graph.ready.has(p.id),
      depends_on: p.frontmatter.depends_on ?? [],
      tags: p.frontmatter.tags ?? [],
      repo: p.frontmatter.repo,
      assignee: p.frontmatter.assignee,
    }));

    const edges: { from: string; to: string }[] = [];
    for (const plan of plans) {
      for (const dep of plan.frontmatter.depends_on ?? []) {
        edges.push({ from: dep, to: plan.id });
      }
    }

    console.log(JSON.stringify({ nodes, edges }, null, 2));
    return;
  }

  // ... existing HTTP server logic unchanged ...
}
```

In `src/cli.ts`, add `--json` to the graph command:

```typescript
program
  .command('graph')
  .description('Open DAG viewer in browser')
  .option('--port <port>', 'Port to serve on', parseInt)
  .option('--json', 'Output graph as JSON (nodes + edges) instead of opening browser')
  .addHelpText('after', '\nExamples:\n  $ trellis graph\n  $ trellis graph --port 8080\n  $ trellis graph --json')
  .action((options) => graphCommand(options));
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/graph.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/commands/graph.ts src/cli.ts tests/commands/graph.test.ts
git commit -m "feat(graph): add --json for DAG export as nodes + edges"
```
