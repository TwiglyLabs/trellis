# Phase 3: Stricter Default Views for `status`

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Hide `done` and `archived` plans from the default `status` view. Add `--all` to show everything, `--done` to include done, `--archived` to include archived.

**Architecture:** Modify `statusCommand` to filter out done/archived plans from the displayed sections by default. The `--json` path should also respect these filters. The graph still includes all plans (so dependency calculations remain correct), but the display filters what's shown. The plan count header should reflect the filtered count.

**Tech Stack:** TypeScript, Vitest

**Related:** [./phase-1-json-output.md](./phase-1-json-output.md), [./phase-2-ready-next.md](./phase-2-ready-next.md), [./phase-4-epic-tracking.md](./phase-4-epic-tracking.md)

**Note on JSON mode:** The `--json` path also respects these filters (done/archived hidden by default). This is intentional — orchestrators that need completion visibility should use `trellis epic` (Phase 4) rather than sifting through a growing pile of done plans in `status --json`. Pass `--all` for the rare case where raw totals are needed.

---

## Task 1: Add filtering flags and update status command

**Files:**
- Modify: `tests/commands/status.test.ts`
- Modify: `src/commands/status.ts`
- Modify: `src/cli.ts`

**Step 1: Write the failing tests**

Add to `tests/commands/status.test.ts`:

```typescript
it('hides done plans by default', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'done' },
    { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
  ]);
  process.cwd = () => root;

  statusCommand({});

  const output = logs.join('\n');
  expect(output).toContain('READY');
  expect(output).toContain('b');
  expect(output).not.toContain('DONE');
  expect(output).toContain('1 plan'); // only b shown in count
});

it('hides archived plans by default', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'archived' },
    { id: 'b', title: 'Plan B', status: 'not_started' },
  ]);
  process.cwd = () => root;

  statusCommand({});

  const output = logs.join('\n');
  expect(output).not.toContain('ARCHIVED');
  expect(output).not.toContain('Plan A');
});

it('--all shows done and archived plans', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'done' },
    { id: 'b', title: 'Plan B', status: 'archived' },
    { id: 'c', title: 'Plan C', status: 'not_started' },
  ]);
  process.cwd = () => root;

  statusCommand({ all: true });

  const output = logs.join('\n');
  expect(output).toContain('DONE');
  expect(output).toContain('3 plans');
});

it('--done shows done but not archived', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'done' },
    { id: 'b', title: 'Plan B', status: 'archived' },
    { id: 'c', title: 'Plan C', status: 'not_started' },
  ]);
  process.cwd = () => root;

  statusCommand({ done: true });

  const output = logs.join('\n');
  expect(output).toContain('DONE');
  expect(output).not.toContain('ARCHIVED');
  expect(output).toContain('2 plans'); // c + a
});

it('--archived shows archived but not done', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'done' },
    { id: 'b', title: 'Plan B', status: 'archived' },
    { id: 'c', title: 'Plan C', status: 'not_started' },
  ]);
  process.cwd = () => root;

  statusCommand({ archived: true });

  const output = logs.join('\n');
  expect(output).not.toContain('DONE');
  expect(output).toContain('ARCHIVED');
  expect(output).toContain('2 plans'); // c + b
});

it('--json respects --all filter', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'done' },
    { id: 'b', title: 'Plan B', status: 'not_started' },
  ]);
  process.cwd = () => root;

  statusCommand({ json: true });

  const parsed = JSON.parse(logs.join(''));
  // Default: done should be excluded
  expect(parsed.plans).toHaveLength(1);
  expect(parsed.plans[0].id).toBe('b');
});

it('--json --all includes done and archived', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'done' },
    { id: 'b', title: 'Plan B', status: 'not_started' },
  ]);
  process.cwd = () => root;

  statusCommand({ json: true, all: true });

  const parsed = JSON.parse(logs.join(''));
  expect(parsed.plans).toHaveLength(2);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/status.test.ts`
Expected: FAIL — existing test `'shows dashboard grouped by status'` now fails because it expects DONE section but default hides it. The new tests also fail.

**Important:** The existing test `'shows dashboard grouped by status'` expects to see `DONE` and `4 plans`. This test needs to be updated to match the new behavior: default view hides done. Update it:

```typescript
it('shows dashboard grouped by status', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'done' },
    { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    { id: 'c', title: 'Plan C', status: 'in_progress' },
    { id: 'd', title: 'Plan D', status: 'draft' },
  ]);
  process.cwd = () => root;

  statusCommand({});

  const output = logs.join('\n');
  expect(output).toContain('READY');
  expect(output).toContain('IN PROGRESS');
  expect(output).toContain('DRAFT');
  expect(output).not.toContain('DONE'); // done hidden by default
  expect(output).toContain('3 plans'); // excludes done
});
```

Also update the existing `'outputs JSON'` test:

```typescript
it('outputs JSON', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'not_started' },
  ]);
  process.cwd = () => root;

  statusCommand({ json: true });

  const parsed = JSON.parse(logs.join(''));
  expect(parsed.project).toBe('test-project');
  expect(parsed.plans).toHaveLength(1);
  expect(parsed.plans[0].id).toBe('a');
});
```

(Changed the fixture from `done` to `not_started` so it still appears in default view.)

**Step 3: Implement**

Update `src/commands/status.ts`:

```typescript
interface StatusOptions {
  tag?: string;
  repo?: string;
  json?: boolean;
  all?: boolean;
  done?: boolean;
  archived?: boolean;
}
```

After the `filterPlans` call, add status-based visibility filtering:

```typescript
export function statusCommand(options: StatusOptions): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);

  if (plans.length === 0) {
    console.log('No plans found.');
    return;
  }

  const graph = buildGraph(plans);
  let filtered = filterPlans(plans, options);

  // Visibility filtering: hide done/archived by default
  const showDone = options.all || options.done;
  const showArchived = options.all || options.archived;

  if (!showDone) {
    filtered = filtered.filter(p => p.frontmatter.status !== 'done');
  }
  if (!showArchived) {
    filtered = filtered.filter(p => p.frontmatter.status !== 'archived');
  }

  if (options.json) {
    const output = {
      project: config.project,
      total: filtered.length,
      plans: filtered.map(p => ({
        id: p.id,
        title: p.frontmatter.title,
        status: p.frontmatter.status,
        blocked: graph.blocked.has(p.id),
        ready: graph.ready.has(p.id),
        depends_on: p.frontmatter.depends_on ?? [],
        tags: p.frontmatter.tags ?? [],
        repo: p.frontmatter.repo,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const readyPlans = filtered.filter(p => graph.ready.has(p.id));
  const blockedPlans = filtered.filter(p => graph.blocked.has(p.id));
  const inProgress = filtered.filter(p => p.frontmatter.status === 'in_progress');
  const drafts = filtered.filter(p => p.frontmatter.status === 'draft');
  const done = filtered.filter(p => p.frontmatter.status === 'done');
  const archived = filtered.filter(p => p.frontmatter.status === 'archived');

  const idWidth = computeColumnWidth(filtered.map(p => p.id));

  console.log(`\n${chalk.bold(config.project)} — ${pluralize(filtered.length, 'plan')}\n`);

  if (readyPlans.length > 0) {
    console.log(chalk.green.bold(`  READY (${readyPlans.length})`));
    for (const p of readyPlans) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  if (blockedPlans.length > 0) {
    console.log(chalk.red.bold(`  BLOCKED (${blockedPlans.length})`));
    for (const p of blockedPlans) {
      const waitingOn = (p.frontmatter.depends_on ?? [])
        .filter(d => {
          const dep = graph.plans.get(d);
          return !dep || dep.frontmatter.status !== 'done';
        });
      console.log(`    ${chalk.white(padRight(p.id, idWidth))} ← waiting on: ${waitingOn.join(', ')}`);
    }
    console.log();
  }

  if (inProgress.length > 0) {
    console.log(chalk.blue.bold(`  IN PROGRESS (${inProgress.length})`));
    for (const p of inProgress) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  if (drafts.length > 0) {
    console.log(chalk.yellow.bold(`  DRAFT (${drafts.length})`));
    for (const p of drafts) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  if (done.length > 0) {
    console.log(chalk.gray.bold(`  DONE (${done.length})`));
    for (const p of done) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }

  if (archived.length > 0) {
    console.log(chalk.gray.bold(`  ARCHIVED (${archived.length})`));
    for (const p of archived) {
      printPlanLine(p, idWidth);
    }
    console.log();
  }
}
```

In `src/cli.ts`, add the new flags to the status command:

```typescript
program
  .command('status')
  .description('Dashboard: what\'s ready, blocked, in progress')
  .option('--tag <tag>', 'Filter by tag')
  .option('--repo <repo>', 'Filter by repo')
  .option('--json', 'Output as JSON')
  .option('--all', 'Show all plans including done and archived')
  .option('--done', 'Include done plans')
  .option('--archived', 'Include archived plans')
  .addHelpText('after', '\nExamples:\n  $ trellis status\n  $ trellis status --tag foundation\n  $ trellis status --json\n  $ trellis status --all\n  $ trellis status --done')
  .action((options) => statusCommand(options));
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/status.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/commands/status.ts src/cli.ts tests/commands/status.test.ts
git commit -m "feat(status): hide done/archived by default, add --all/--done/--archived"
```

---

## Task 2: Final integration check

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 2: Build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 3: Smoke test**

Run the CLI manually against a test project if available:

```bash
node dist/trellis.cjs status
node dist/trellis.cjs status --all
node dist/trellis.cjs ready --json
node dist/trellis.cjs ready --next
node dist/trellis.cjs lint --json
```

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: fix any issues from integration testing"
```
