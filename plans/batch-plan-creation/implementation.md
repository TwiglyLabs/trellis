## Steps
### Task 1: Implement `computeCreateBatch` core logic

**Files:**
- Create: `src/features/create/batch.ts`
- Test: `src/__tests__/batch.test.ts`

**Step 1: Write failing tests**

```typescript
import { computeCreateBatch } from '../features/create/batch.ts';

describe('computeCreateBatch', () => {
  it('creates plans in topological order', () => {
    const { roots, cleanup } = createMultiRepoFixture([
      { alias: 'repo-a', plans: [] },
      { alias: 'repo-b', plans: [] },
    ]);
    const store = createStore(roots);

    const result = computeCreateBatch({
      plans: [
        { id: 'repo-a:plan-b', title: 'Plan B', depends_on: ['repo-a:plan-a'] },
        { id: 'repo-a:plan-a', title: 'Plan A' },
      ],
      store,
    });

    expect(result.created).toHaveLength(2);
    expect(result.created[0].id).toBe('repo-a:plan-a'); // created first (no deps)
    expect(result.created[1].id).toBe('repo-a:plan-b'); // created second (depends on A)
    cleanup();
  });

  it('validates deps against union of existing + batch', () => {
    const { roots, cleanup } = createMultiRepoFixture([
      { alias: 'repo-a', plans: [{ id: 'existing', title: 'Existing', status: 'draft' }] },
    ]);
    const store = createStore(roots);

    const result = computeCreateBatch({
      plans: [
        { id: 'repo-a:new-plan', title: 'New', depends_on: ['repo-a:existing'] },
      ],
      store,
    });

    expect(result.created).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    cleanup();
  });

  it('detects cycles', () => {
    const { roots, cleanup } = createMultiRepoFixture([
      { alias: 'repo-a', plans: [] },
    ]);
    const store = createStore(roots);

    expect(() => computeCreateBatch({
      plans: [
        { id: 'repo-a:a', title: 'A', depends_on: ['repo-a:b'] },
        { id: 'repo-a:b', title: 'B', depends_on: ['repo-a:a'] },
      ],
      store,
    })).toThrow(/cycle/i);
    cleanup();
  });

  it('errors on dep not in universe', () => {
    const { roots, cleanup } = createMultiRepoFixture([
      { alias: 'repo-a', plans: [] },
    ]);
    const store = createStore(roots);

    expect(() => computeCreateBatch({
      plans: [
        { id: 'repo-a:plan', title: 'Plan', depends_on: ['repo-a:nonexistent'] },
      ],
      store,
    })).toThrow(/not found/);
    cleanup();
  });

  it('skips plans that already exist', () => {
    const { roots, cleanup } = createMultiRepoFixture([
      { alias: 'repo-a', plans: [{ id: 'existing', title: 'Existing', status: 'draft' }] },
    ]);
    const store = createStore(roots);

    const result = computeCreateBatch({
      plans: [
        { id: 'repo-a:existing', title: 'Existing' },
        { id: 'repo-a:new-plan', title: 'New' },
      ],
      store,
    });

    expect(result.created).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].id).toBe('repo-a:existing');
    cleanup();
  });

  it('supports dry-run mode', () => {
    const { roots, cleanup } = createMultiRepoFixture([
      { alias: 'repo-a', plans: [] },
    ]);
    const store = createStore(roots);

    const result = computeCreateBatch({
      plans: [
        { id: 'repo-a:plan-a', title: 'A' },
      ],
      store,
      dryRun: true,
    });

    expect(result.created).toHaveLength(0);
    expect(result.wouldCreate).toHaveLength(1);
    // Verify no files written
    expect(existsSync(join(roots[0].path, 'plans', 'plan-a'))).toBe(false);
    cleanup();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/__tests__/batch.test.ts`
Expected: FAIL — module doesn't exist.

**Step 3: Implement `computeCreateBatch`**

Core structure:

```typescript
export interface BatchPlanSpec {
  id: string;           // qualified: repo:plan-id
  title: string;
  type?: string;
  depends_on?: string[];
  tags?: string[];
  description?: string;
}

export interface BatchResult {
  created: Array<{ id: string; filePath: string }>;
  skipped: Array<{ id: string; reason: string }>;
  errors: Array<{ id: string; error: string }>;
  wouldCreate?: Array<{ id: string }>; // dry-run only
}

export function computeCreateBatch(options: {
  plans: BatchPlanSpec[];
  store: ContextStore;
  dryRun?: boolean;
}): BatchResult {
  const { plans, store, dryRun } = options;
  const ctx = store.load();

  // 1. Build universe: existing plan IDs + batch plan IDs
  const universe = new Set<string>(ctx.graph.plans.keys());
  for (const plan of plans) universe.add(plan.id);

  // 2. Validate all deps exist in universe
  for (const plan of plans) {
    for (const dep of plan.depends_on ?? []) {
      if (!universe.has(dep)) {
        throw new Error(`Plan "${plan.id}": dependency "${dep}" not found in existing plans or batch.`);
      }
    }
  }

  // 3. Topo-sort batch plans (only batch plans, not existing)
  const sorted = topologicalSort(plans);

  // 4. Create in order
  const result: BatchResult = { created: [], skipped: [], errors: [] };
  if (dryRun) result.wouldCreate = [];

  for (const plan of sorted) {
    const parsed = parseQualifiedId(plan.id);
    if (!parsed.repo) throw new Error(`Batch plan ID must be qualified: ${plan.id}`);

    // Skip if exists
    if (ctx.graph.plans.has(plan.id)) {
      result.skipped.push({ id: plan.id, reason: 'already exists' });
      continue;
    }

    if (dryRun) {
      result.wouldCreate!.push({ id: plan.id });
      continue;
    }

    // Resolve target and dequalify deps
    const plansDir = store.getPlansDir(parsed.repo);
    const dequalifiedDeps = dequalifyDepsForWrite(plan.depends_on, parsed.repo);

    const createResult = computeCreate({
      id: parsed.planId,
      opts: { title: plan.title, description: plan.description, depends_on: dequalifiedDeps, tags: plan.tags, type: plan.type },
      plansDir,
      graph: ctx.graph,  // Note: use universe-aware validation, not raw graph
      projectDir: store.getRepoPath(parsed.repo),
    });

    result.created.push({ id: plan.id, filePath: createResult.filePath });
    store.invalidate(parsed.repo); // Rescan so next plan sees this one
  }

  return result;
}
```

Note: `computeCreate` validates deps against `graph.plans.has(dep)`. For batch, deps within the batch may not be in the graph yet (they're created in order). Two options:
- Skip dep validation in `computeCreate` and do it in `computeCreateBatch` against the universe (pass a flag to skip validation)
- Invalidate after each create so the graph stays current (simpler but slightly slower)

Prefer the invalidate approach — simpler, correctness over speed. The graph rescans are mtime-based and fast for small changes.

**Step 4: Implement `topologicalSort` helper**

Kahn's algorithm. Operates on batch plans only. Detects cycles.

```typescript
function topologicalSort(plans: BatchPlanSpec[]): BatchPlanSpec[] {
  const ids = new Set(plans.map(p => p.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const plan of plans) {
    inDegree.set(plan.id, 0);
    adj.set(plan.id, []);
  }

  for (const plan of plans) {
    for (const dep of plan.depends_on ?? []) {
      if (ids.has(dep)) {
        // dep is in the batch — plan must come after dep
        adj.get(dep)!.push(plan.id);
        inDegree.set(plan.id, (inDegree.get(plan.id) ?? 0) + 1);
      }
      // deps outside the batch are already created — no ordering constraint
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const next of adj.get(current) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  if (sorted.length !== plans.length) {
    const remaining = plans.filter(p => !sorted.includes(p.id)).map(p => p.id);
    throw new Error(`Cycle detected in batch plans: ${remaining.join(', ')}`);
  }

  const planMap = new Map(plans.map(p => [p.id, p]));
  return sorted.map(id => planMap.get(id)!);
}
```

**Step 5: Run tests to verify they pass**

Run: `npm test -- --run src/__tests__/batch.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/features/create/batch.ts src/__tests__/batch.test.ts
git commit -m "feat: computeCreateBatch with topo-sort, cycle detection, union validation"
```

---

### Task 2: Add `trellis create-batch` CLI command

**Files:**
- Create: `src/features/create/batch-command.ts`
- Modify: `src/cli.ts` (register the command)
- Test: `src/__tests__/batch-cli.test.ts`

**Step 1: Write failing test**

```typescript
describe('trellis create-batch CLI', () => {
  it('creates plans from YAML file', () => {
    const { roots, metaRoot, cleanup } = createCliFixtureWithManifest([
      { alias: 'repo-a', plans: [] },
    ]);

    const batchFile = join(metaRoot, 'batch.yaml');
    writeFileSync(batchFile, `
plans:
  - id: repo-a:plan-a
    title: Plan A
  - id: repo-a:plan-b
    title: Plan B
    depends_on: [repo-a:plan-a]
`);

    process.cwd = () => roots[0].path;
    createBatchCommand(batchFile, {});

    expect(existsSync(join(roots[0].path, 'plans', 'plan-a', 'README.md'))).toBe(true);
    expect(existsSync(join(roots[0].path, 'plans', 'plan-b', 'README.md'))).toBe(true);
    cleanup();
  });

  it('dry-run does not write files', () => {
    const { roots, metaRoot, cleanup } = createCliFixtureWithManifest([
      { alias: 'repo-a', plans: [] },
    ]);

    const batchFile = join(metaRoot, 'batch.yaml');
    writeFileSync(batchFile, `
plans:
  - id: repo-a:plan-a
    title: Plan A
`);

    process.cwd = () => roots[0].path;
    createBatchCommand(batchFile, { dryRun: true });

    expect(existsSync(join(roots[0].path, 'plans', 'plan-a'))).toBe(false);
    cleanup();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/__tests__/batch-cli.test.ts`
Expected: FAIL

**Step 3: Implement CLI command**

```typescript
import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { computeCreateBatch, type BatchPlanSpec } from './batch.ts';
import { resolveCliContext } from '../../core/cli-context.ts';

export function register(program: Command): void {
  program
    .command('create-batch <file>')
    .description('Create multiple plans from a YAML batch file')
    .option('--dry-run', 'Validate without creating files')
    .action((file, options) => createBatchCommand(file, options));
}

export function createBatchCommand(file: string, options: { dryRun?: boolean }): void {
  const raw = readFileSync(file, 'utf8');
  const parsed = parseYaml(raw);
  const plans: BatchPlanSpec[] = parsed.plans;

  const ctx = resolveCliContext(process.cwd());
  if (!ctx.isMultiRepo) {
    throw new Error('create-batch requires a multi-repo setup. Set project_root in .trellis/config.');
  }

  const result = computeCreateBatch({
    plans,
    store: ctx.store,
    dryRun: options.dryRun,
  });

  // Output results
  if (options.dryRun) {
    console.log(`Dry run: would create ${result.wouldCreate!.length} plans`);
    for (const p of result.wouldCreate!) console.log(`  + ${p.id}`);
  } else {
    console.log(`Created ${result.created.length} plans`);
    for (const p of result.created) console.log(`  + ${p.id}`);
  }
  if (result.skipped.length) {
    console.log(`Skipped ${result.skipped.length} (already exist)`);
    for (const p of result.skipped) console.log(`  ~ ${p.id}`);
  }
}
```

Note: `resolveCliContext` needs to expose the `ContextStore` instance for batch — adjust the interface to include `store` when in multi-repo mode.

**Step 4: Register command in CLI entrypoint**

In `src/cli.ts`, import and register the batch command alongside the existing `create` command.

**Step 5: Run tests to verify they pass**

Run: `npm test -- --run src/__tests__/batch-cli.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/features/create/batch-command.ts src/cli.ts src/__tests__/batch-cli.test.ts
git commit -m "feat: trellis create-batch CLI command"
```

---

### Task 3: Add `trellis_create_batch` MCP tool

**Files:**
- Modify: `src/mcp.ts` (register new tool)
- Test: `src/__tests__/mcp.test.ts`

**Step 1: Write failing test**

```typescript
describe('trellis_create_batch MCP tool', () => {
  it('creates batch of plans across repos', async () => {
    const { roots, cleanup } = createMultiRepoFixture([
      { alias: 'repo-a', plans: [] },
      { alias: 'repo-b', plans: [] },
    ]);

    const server = createMcpServer({ repos: roots });
    const result = await callTool(server, 'trellis_create_batch', {
      plans: [
        { id: 'repo-a:plan-a', title: 'Plan A' },
        { id: 'repo-b:plan-b', title: 'Plan B', depends_on: ['repo-a:plan-a'] },
      ],
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text);
    expect(output.created).toHaveLength(2);
    cleanup();
  });

  it('returns validation errors without writing', async () => {
    const { roots, cleanup } = createMultiRepoFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    const server = createMcpServer({ repos: roots });
    const result = await callTool(server, 'trellis_create_batch', {
      plans: [
        { id: 'repo-a:plan', title: 'Plan', depends_on: ['repo-a:missing'] },
      ],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
    cleanup();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/__tests__/mcp.test.ts -t 'trellis_create_batch'`
Expected: FAIL — tool not registered.

**Step 3: Register MCP tool**

In `src/mcp.ts`, register `trellis_create_batch`:

```typescript
server.registerTool('trellis_create_batch', {
  description: 'Create multiple plans in one operation with dependency validation',
  inputSchema: {
    type: 'object',
    properties: {
      plans: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Qualified plan ID (repo:plan-id)' },
            title: { type: 'string' },
            type: { type: 'string' },
            depends_on: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: { type: 'string' } },
            description: { type: 'string' },
          },
          required: ['id', 'title'],
        },
      },
      dry_run: { type: 'boolean', description: 'Validate without creating files' },
    },
    required: ['plans'],
  },
}, async ({ plans, dry_run }) => {
  const result = computeCreateBatch({
    plans,
    store,
    dryRun: dry_run,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
});
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/__tests__/mcp.test.ts -t 'trellis_create_batch'`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/mcp.ts src/__tests__/mcp.test.ts
git commit -m "feat: trellis_create_batch MCP tool"
```
## Testing
- Unit tests for `computeCreateBatch` — topo-sort ordering, cycle detection, union validation, skip-existing, dry-run
- Unit test for `topologicalSort` helper — ordering correctness, cycle detection error
- Integration: CLI `create-batch` with YAML file creates plans across repos
- Integration: CLI `create-batch --dry-run` validates without writing
- Integration: MCP `trellis_create_batch` creates batch, returns structured results
- Integration: MCP batch with invalid deps returns error without writing
- Full suite (`npm test`) after each task
## Done-when
- `computeCreateBatch()` exists with topo-sort, cycle detection, and union dep validation
- `trellis create-batch <file>` CLI command reads YAML and creates plans in dependency order
- `--dry-run` flag validates the batch without writing any files
- `trellis_create_batch` MCP tool accepts a plans array and returns structured results
- Plans created in correct topological order across repos
- Same-repo deps dequalified on disk, cross-repo deps preserved
- Existing plans skipped with `already exists` status
- All existing tests pass unchanged
