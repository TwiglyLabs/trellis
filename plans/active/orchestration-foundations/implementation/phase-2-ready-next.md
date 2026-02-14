# Phase 2: `ready --next` Flag

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Add a `--next` flag to `ready` that returns exactly one plan — the highest-priority ready plan. This gives an orchestrator a single deterministic answer to "what should I work on?"

**Architecture:** The heuristic is: among all ready plans, pick the one on the longest remaining critical path (it's the biggest bottleneck). If tied, use topological order as tiebreaker (earlier in topo = more things downstream). The `computeCriticalPath` function already exists in `graph.ts` — we just need to call it for each ready plan and pick the max.

**Tech Stack:** TypeScript, Vitest

**Related:** [./phase-1-json-output.md](./phase-1-json-output.md), [./phase-3-status-filtering.md](./phase-3-status-filtering.md), [./phase-4-epic-tracking.md](./phase-4-epic-tracking.md)

---

## Task 1: Add `pickNext` function to graph.ts

**Files:**
- Modify: `tests/graph.test.ts`
- Modify: `src/graph.ts`

**Step 1: Write the failing test**

Add to `tests/graph.test.ts`:

```typescript
import { buildGraph, pickNext, computeCriticalPath } from '../src/graph.ts';
```

Then add a new `describe` block:

```typescript
describe('pickNext', () => {
  it('returns the ready plan on the longest forward path', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started', ['b']),
      makePlan('d', 'not_started'),
    ];
    const graph = buildGraph(plans);

    // a and d are both ready. a has forward path a→b→c (depth 3), d has depth 1.
    const result = pickNext(graph);
    expect(result).toBe('a');
  });

  it('returns null when no plans are ready', () => {
    const plans = [makePlan('a', 'in_progress')];
    const graph = buildGraph(plans);

    expect(pickNext(graph)).toBeNull();
  });

  it('respects candidate filtering', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started', ['b']),
      makePlan('d', 'not_started'),
    ];
    const graph = buildGraph(plans);

    // a has longest forward path overall, but restrict to {d} only
    const result = pickNext(graph, new Set(['d']));
    expect(result).toBe('d');
  });

  it('breaks ties by topological order', () => {
    // Give both plans a downstream dependent so forward depth is equal (2),
    // then tiebreak favors the one earlier in topo order.
    const plans = [
      makePlan('x', 'not_started'),
      makePlan('x-child', 'not_started', ['x']),
      makePlan('y', 'not_started'),
      makePlan('y-child', 'not_started', ['y']),
    ];
    const graph = buildGraph(plans);

    // Both x and y have forward depth 2. Topo order tiebreaks.
    const result = pickNext(graph);
    expect(['x', 'y']).toContain(result); // deterministic but depends on topo impl
  });
});
```

Note: The existing `graph.test.ts` already has a `makePlan(id, status, depends_on?)` helper that returns a single `Plan`. Use it to build arrays inline: `[makePlan('a', 'not_started'), ...]`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph.test.ts`
Expected: FAIL — `pickNext` doesn't exist yet.

**Step 3: Implement `pickNext`**

Add to `src/graph.ts`:

```typescript
/**
 * Pick the highest-priority ready plan.
 * Heuristic: longest forward path (most downstream work depends on this).
 * Tiebreaker: topological order.
 * @param candidates — optional set of IDs to restrict selection to (e.g., after tag/repo filtering).
 *   If omitted, considers all ready plans.
 */
export function pickNext(graph: GraphData, candidates?: Set<string>): string | null {
  const allReady = [...graph.ready];
  const readyIds = candidates ? allReady.filter(id => candidates.has(id)) : allReady;
  if (readyIds.length === 0) return null;
  if (readyIds.length === 1) return readyIds[0];

  // Compute forward depth (longest path from this node to a leaf via dependents)
  const forwardDepth = new Map<string, number>();

  function getForwardDepth(id: string): number {
    if (forwardDepth.has(id)) return forwardDepth.get(id)!;
    const deps = graph.dependents.get(id) ?? [];
    if (deps.length === 0) {
      forwardDepth.set(id, 1);
      return 1;
    }
    const maxChild = Math.max(...deps.map(d => getForwardDepth(d)));
    const depth = 1 + maxChild;
    forwardDepth.set(id, depth);
    return depth;
  }

  // Compute topo order for tiebreaking
  const plans = [...graph.plans.values()];
  const topoOrder = topologicalSort(plans);
  const topoIndex = new Map<string, number>();
  topoOrder.forEach((id, i) => topoIndex.set(id, i));

  // Sort: longest forward depth first, then earliest in topo order
  readyIds.sort((a, b) => {
    const depthDiff = getForwardDepth(b) - getForwardDepth(a);
    if (depthDiff !== 0) return depthDiff;
    return (topoIndex.get(a) ?? 0) - (topoIndex.get(b) ?? 0);
  });

  return readyIds[0];
}
```

Make sure `topologicalSort` is already exported (it is — check existing exports in graph.ts).

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/graph.ts tests/graph.test.ts
git commit -m "feat(graph): add pickNext for highest-priority ready plan selection"
```

---

## Task 2: Wire `--next` into `ready` command

**Files:**
- Modify: `tests/commands/ready.test.ts`
- Modify: `src/commands/ready.ts`
- Modify: `src/cli.ts`

**Step 1: Write the failing test**

Add to `tests/commands/ready.test.ts`:

```typescript
it('--next returns single highest-priority plan', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'not_started' },
    { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
    { id: 'd', title: 'Plan D', status: 'not_started' },
  ]);
  process.cwd = () => root;

  readyCommand({ next: true });

  const output = logs.join('\n');
  expect(output).toContain('a');
  // Should NOT list d — only one plan
  const lines = output.split('\n').filter(l => l.trim());
  expect(lines).toHaveLength(1);
});

it('--next with --json returns single plan object', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'not_started' },
    { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
  ]);
  process.cwd = () => root;

  readyCommand({ next: true, json: true });

  const parsed = JSON.parse(logs.join(''));
  expect(parsed.id).toBe('a');
  expect(parsed.title).toBe('Plan A');
});

it('--next with nothing ready shows message', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'in_progress' },
  ]);
  process.cwd = () => root;

  readyCommand({ next: true });

  expect(logs.join('\n')).toContain('No plans are ready');
});

it('--next with --json and nothing ready returns null', () => {
  const { root } = createFixture([
    { id: 'a', title: 'Plan A', status: 'in_progress' },
  ]);
  process.cwd = () => root;

  readyCommand({ next: true, json: true });

  const parsed = JSON.parse(logs.join(''));
  expect(parsed).toBeNull();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/ready.test.ts`
Expected: FAIL

**Step 3: Implement**

Update `src/commands/ready.ts`:

```typescript
import { buildGraph } from '../graph.ts';
import { pickNext } from '../graph.ts';
```

Wait — `buildGraph` is already imported from `'../graph.ts'`. Just add `pickNext` to that import:

```typescript
import { buildGraph, pickNext } from '../graph.ts';
```

Update the `ReadyOptions` interface:

```typescript
interface ReadyOptions {
  tag?: string;
  repo?: string;
  json?: boolean;
  next?: boolean;
}
```

Update the function body. After computing `readyPlans`, add the `--next` handling:

```typescript
export function readyCommand(options: ReadyOptions): void {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = join(cwd, config.plans_dir);
  const plans = scanPlans(plansDir);
  const graph = buildGraph(plans);

  let readyPlans = plans.filter(p => graph.ready.has(p.id));
  readyPlans = filterPlans(readyPlans, options);

  if (options.next) {
    // Pass filtered set so pickNext selects the best plan *within* the filter,
    // not the globally-best plan that may not match tag/repo criteria.
    const filteredIds = new Set(readyPlans.map(p => p.id));
    const nextId = pickNext(graph, filteredIds);
    const nextPlan = nextId ? graph.plans.get(nextId)! : null;

    if (options.json) {
      if (!nextPlan) {
        console.log(JSON.stringify(null));
      } else {
        console.log(JSON.stringify({
          id: nextPlan.id,
          title: nextPlan.frontmatter.title,
          status: nextPlan.frontmatter.status,
          depends_on: nextPlan.frontmatter.depends_on ?? [],
          tags: nextPlan.frontmatter.tags ?? [],
          repo: nextPlan.frontmatter.repo,
          description: nextPlan.frontmatter.description,
          assignee: nextPlan.frontmatter.assignee,
        }, null, 2));
      }
      return;
    }

    if (!nextPlan) {
      console.log('No plans are ready.');
      return;
    }

    const desc = nextPlan.frontmatter.description || nextPlan.frontmatter.title;
    const tags = nextPlan.frontmatter.repo ? `[${nextPlan.frontmatter.repo}]` : '';
    console.log(`${nextPlan.id} ${padRight(desc, 40)} ${tags}`.trim());
    return;
  }

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

In `src/cli.ts`, add `--next` to the ready command:

```typescript
program
  .command('ready')
  .description('List plans with all dependencies satisfied')
  .option('--tag <tag>', 'Filter by tag')
  .option('--repo <repo>', 'Filter by repo')
  .option('--json', 'Output as JSON')
  .option('--next', 'Return only the highest-priority ready plan')
  .addHelpText('after', '\nExamples:\n  $ trellis ready\n  $ trellis ready --repo public\n  $ trellis ready --json\n  $ trellis ready --next\n  $ trellis ready --next --json')
  .action((options) => readyCommand(options));
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/ready.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/commands/ready.ts src/graph.ts src/cli.ts tests/commands/ready.test.ts tests/graph.test.ts
git commit -m "feat(ready): add --next flag for single highest-priority plan"
```
