# Phase 4: Epic Tracking

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Add epic-based completion tracking. Plans tag themselves with `tags: [epic:name]` using the existing tags field — no schema changes needed. A new `trellis epic` command reports completion status per epic, giving orchestrators visibility into progress without cluttering the default status view with done plans.

**Architecture:** Epics are a convention on existing tags. The `epic` command scans all plans (including done/archived), extracts tags matching `epic:*`, groups by epic name, and computes per-epic completion stats. A plan can belong to multiple epics.

**Tech Stack:** TypeScript, Vitest

**Related:** [./phase-1-json-output.md](./phase-1-json-output.md), [./phase-2-ready-next.md](./phase-2-ready-next.md), [./phase-3-status-filtering.md](./phase-3-status-filtering.md)

---

## Task 1: Add `epic` command — list all epics

**Files:**
- Create: `tests/commands/epic.test.ts`
- Create: `src/commands/epic.ts`
- Modify: `src/cli.ts`

**Step 1: Write the failing test**

Create `tests/commands/epic.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { epicCommand } from '../../src/commands/epic.ts';
import { createFixture } from '../helpers.ts';

describe('epic command', () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const origCwd = process.cwd;

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
  });

  afterEach(() => {
    process.cwd = origCwd;
    vi.restoreAllMocks();
  });

  it('lists all epics with completion stats', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', tags: ['epic:v1'] },
      { id: 'b', title: 'Plan B', status: 'in_progress', tags: ['epic:v1'] },
      { id: 'c', title: 'Plan C', status: 'not_started', tags: ['epic:v1'] },
      { id: 'd', title: 'Plan D', status: 'done', tags: ['epic:v2'] },
      { id: 'e', title: 'Plan E', status: 'done', tags: ['epic:v2'] },
      { id: 'f', title: 'Plan F', status: 'not_started' },
    ]);
    process.cwd = () => root;

    epicCommand({});

    const output = logs.join('\n');
    expect(output).toContain('v1');
    expect(output).toContain('1/3');
    expect(output).toContain('v2');
    expect(output).toContain('2/2');
  });

  it('shows message when no epics exist', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);
    process.cwd = () => root;

    epicCommand({});

    expect(logs.join('\n')).toContain('No epics found');
  });

  it('lists epics as JSON', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', tags: ['epic:v1'] },
      { id: 'b', title: 'Plan B', status: 'not_started', tags: ['epic:v1'] },
    ]);
    process.cwd = () => root;

    epicCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].epic).toBe('v1');
    expect(parsed[0].total).toBe(2);
    expect(parsed[0].done).toBe(1);
    expect(parsed[0].progress).toBeCloseTo(0.5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/epic.test.ts`
Expected: FAIL — module doesn't exist.

**Step 3: Implement**

Create `src/commands/epic.ts`:

```typescript
import chalk from 'chalk';
import { join } from 'path';
import { loadConfig, scanPlans } from '../scanner.ts';
import { buildGraph } from '../graph.ts';
import { padRight, computeColumnWidth } from '../utils.ts';

interface EpicSummary {
  epic: string;
  total: number;
  done: number;
  in_progress: number;
  not_started: number;
  blocked: number;
  draft: number;
  progress: number;
}

interface EpicOptions {
  json?: boolean;
}

function collectEpics(plans: ReturnType<typeof scanPlans>, graph: ReturnType<typeof buildGraph>): EpicSummary[] {
  const epicMap = new Map<string, ReturnType<typeof scanPlans>>();

  for (const plan of plans) {
    for (const tag of plan.frontmatter.tags ?? []) {
      if (tag.startsWith('epic:')) {
        const name = tag.slice(5);
        if (!epicMap.has(name)) epicMap.set(name, []);
        epicMap.get(name)!.push(plan);
      }
    }
  }

  const summaries: EpicSummary[] = [];
  for (const [epic, epicPlans] of epicMap) {
    const total = epicPlans.length;
    const done = epicPlans.filter(p => p.frontmatter.status === 'done').length;
    summaries.push({
      epic,
      total,
      done,
      in_progress: epicPlans.filter(p => p.frontmatter.status === 'in_progress').length,
      not_started: epicPlans.filter(p => p.frontmatter.status === 'not_started').length,
      blocked: epicPlans.filter(p => graph.blocked.has(p.id)).length,
      draft: epicPlans.filter(p => p.frontmatter.status === 'draft').length,
      progress: total > 0 ? done / total : 0,
    });
  }

  return summaries.sort((a, b) => a.epic.localeCompare(b.epic));
}

export function epicCommand(options: EpicOptions): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);
  const graph = buildGraph(plans);
  const epics = collectEpics(plans, graph);

  if (epics.length === 0) {
    if (options.json) {
      console.log(JSON.stringify([]));
    } else {
      console.log('No epics found. Tag plans with epic:<name> to track completion.');
    }
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(epics, null, 2));
    return;
  }

  const nameWidth = computeColumnWidth(epics.map(e => e.epic));

  for (const e of epics) {
    const pct = Math.round(e.progress * 100);
    const bar = progressBar(e.progress, 10);
    console.log(`  ${chalk.white(padRight(e.epic, nameWidth))}  ${e.done}/${e.total} done  ${bar}  ${pct}%`);
  }
}

function progressBar(ratio: number, width: number): string {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return chalk.green('\u2593'.repeat(filled)) + chalk.dim('\u2591'.repeat(empty));
}
```

Wire into `src/cli.ts`:

```typescript
import { epicCommand } from './commands/epic.ts';

program
  .command('epic [name]')
  .description('Show epic completion status')
  .option('--json', 'Output as JSON')
  .addHelpText('after', '\nExamples:\n  $ trellis epic\n  $ trellis epic v1\n  $ trellis epic --json')
  .action((name, options) => epicCommand(options, name));
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/epic.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/epic.ts src/cli.ts tests/commands/epic.test.ts
git commit -m "feat(epic): add epic command for completion tracking"
```

---

## Task 2: Add single-epic detail view

**Files:**
- Modify: `tests/commands/epic.test.ts`
- Modify: `src/commands/epic.ts`

**Step 1: Write the failing test**

Add to `tests/commands/epic.test.ts`:

```typescript
it('shows detail for a single epic', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'done', tags: ['epic:v1'] },
    { id: 'b', title: 'Plan B', status: 'in_progress', tags: ['epic:v1'] },
    { id: 'c', title: 'Plan C', status: 'not_started', tags: ['epic:v1'], depends_on: ['b'] },
  ]);
  process.cwd = () => root;

  epicCommand({}, 'v1');

  const output = logs.join('\n');
  expect(output).toContain('v1');
  expect(output).toContain('1/3');
  expect(output).toContain('Plan A');
  expect(output).toContain('Plan B');
  expect(output).toContain('Plan C');
});

it('shows single epic as JSON', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'done', tags: ['epic:v1'] },
    { id: 'b', title: 'Plan B', status: 'not_started', tags: ['epic:v1'] },
  ]);
  process.cwd = () => root;

  epicCommand({ json: true }, 'v1');

  const parsed = JSON.parse(logs.join(''));
  expect(parsed.epic).toBe('v1');
  expect(parsed.total).toBe(2);
  expect(parsed.done).toBe(1);
  expect(parsed.plans).toHaveLength(2);
  expect(parsed.plans[0]).toHaveProperty('id');
  expect(parsed.plans[0]).toHaveProperty('status');
});

it('shows error for unknown epic', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'not_started', tags: ['epic:v1'] },
  ]);
  process.cwd = () => root;

  epicCommand({}, 'nonexistent');

  expect(errors.join('\n')).toContain('not found');
});

it('shows JSON error for unknown epic', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'not_started', tags: ['epic:v1'] },
  ]);
  process.cwd = () => root;

  epicCommand({ json: true }, 'nonexistent');

  const parsed = JSON.parse(errors.join(''));
  expect(parsed.error).toContain('not found');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/epic.test.ts`
Expected: FAIL — `epicCommand` doesn't accept a name argument.

**Step 3: Implement**

Update `epicCommand` signature and add single-epic detail view:

```typescript
export function epicCommand(options: EpicOptions, name?: string): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);
  const graph = buildGraph(plans);
  const epics = collectEpics(plans, graph);

  if (name) {
    return showSingleEpic(name, epics, plans, graph, options);
  }

  // ... existing list-all-epics logic ...
}

function showSingleEpic(
  name: string,
  epics: EpicSummary[],
  plans: ReturnType<typeof scanPlans>,
  graph: ReturnType<typeof buildGraph>,
  options: EpicOptions,
): void {
  const epic = epics.find(e => e.epic === name);

  if (!epic) {
    if (options.json) {
      console.error(JSON.stringify({ error: `Epic "${name}" not found.` }));
    } else {
      console.error(`Epic "${name}" not found.`);
    }
    process.exitCode = 1;
    return;
  }

  // Get plans belonging to this epic
  const epicPlans = plans.filter(p =>
    (p.frontmatter.tags ?? []).includes(`epic:${name}`)
  );

  if (options.json) {
    console.log(JSON.stringify({
      ...epic,
      plans: epicPlans.map(p => ({
        id: p.id,
        title: p.frontmatter.title,
        status: p.frontmatter.status,
        blocked: graph.blocked.has(p.id),
        ready: graph.ready.has(p.id),
      })),
    }, null, 2));
    return;
  }

  const pct = Math.round(epic.progress * 100);
  console.log(`\n${chalk.bold(name)} — ${epic.done}/${epic.total} done (${pct}%)\n`);

  const idWidth = computeColumnWidth(epicPlans.map(p => p.id));

  const done = epicPlans.filter(p => p.frontmatter.status === 'done');
  const remaining = epicPlans.filter(p => p.frontmatter.status !== 'done');

  if (remaining.length > 0) {
    console.log(chalk.yellow.bold(`  REMAINING (${remaining.length})`));
    for (const p of remaining) {
      const statusLabel = graph.blocked.has(p.id) ? chalk.red('blocked') : chalk.dim(p.frontmatter.status);
      console.log(`    ${chalk.white(padRight(p.id, idWidth))} ${p.frontmatter.title}  ${statusLabel}`);
    }
    console.log();
  }

  if (done.length > 0) {
    console.log(chalk.green.bold(`  DONE (${done.length})`));
    for (const p of done) {
      console.log(`    ${chalk.dim(padRight(p.id, idWidth))} ${chalk.dim(p.frontmatter.title)}`);
    }
    console.log();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/epic.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/commands/epic.ts tests/commands/epic.test.ts
git commit -m "feat(epic): add single-epic detail view with plan breakdown"
```
