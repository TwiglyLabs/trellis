## Steps
### Task 1: Create `resolveCliContext` helper

**Files:**
- Create: `src/core/cli-context.ts`
- Test: `src/__tests__/cli-context.test.ts`

**Step 1: Write failing tests**

```typescript
import { resolveCliContext } from '../core/cli-context.ts';

describe('resolveCliContext', () => {
  it('returns multi-repo context when project_root is set', () => {
    // Fixture: repo with .trellis/config pointing to project_root that has .trellis-project
    const { root, metaRoot, cleanup } = createCliFixtureWithManifest([
      { alias: 'repo-a', plans: [{ id: 'plan-a', title: 'A', status: 'draft' }] },
      { alias: 'repo-b', plans: [] },
    ]);

    const ctx = resolveCliContext(root);
    expect(ctx.isMultiRepo).toBe(true);
    expect(ctx.graph.plans.has('repo-a:plan-a')).toBe(true);
    cleanup();
  });

  it('returns single-repo context when no manifest available', () => {
    const { root } = createFixture([
      { id: 'local-plan', title: 'Local', status: 'draft' },
    ]);

    const ctx = resolveCliContext(root);
    expect(ctx.isMultiRepo).toBe(false);
    expect(ctx.graph.plans.has('local-plan')).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/__tests__/cli-context.test.ts`
Expected: FAIL — module doesn't exist.

**Step 3: Implement `resolveCliContext`**

```typescript
import { loadConfig } from './config.ts';
import { createContext } from './context.ts';
import { ContextStore, type RepoSpec } from './store.ts';
import { loadProjectRepos } from './manifest.ts';
import { existsSync } from 'fs';
import { join } from 'path';

export interface CliContext {
  isMultiRepo: boolean;
  graph: GraphData;
  getPlansDir(alias?: string): string;
  config: TrellisConfig;
  projectDir: string;
}

export function resolveCliContext(projectDir: string): CliContext {
  const config = loadConfig(projectDir);

  // Try multi-repo: project_root with manifest
  if (config.project_root) {
    const projectRoot = expandTilde(config.project_root);
    const manifestPath = join(projectRoot, '.trellis-project');
    if (existsSync(manifestPath)) {
      const { specs } = loadProjectRepos(projectRoot);
      const store = new ContextStore({ repos: specs, qualifyIds: true });
      const multi = store.load();
      return {
        isMultiRepo: true,
        graph: multi.graph,
        getPlansDir: (alias) => store.getPlansDir(alias),
        config,
        projectDir,
      };
    }
  }

  // Fallback: single-repo
  const ctx = createContext(projectDir);
  return {
    isMultiRepo: false,
    graph: ctx.graph,
    getPlansDir: () => ctx.plansDir,
    config,
    projectDir,
  };
}
```

Note: Check exact imports and function signatures against the actual codebase — the above is structural guidance, not copy-paste.

**Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/__tests__/cli-context.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/cli-context.ts src/__tests__/cli-context.test.ts
git commit -m "feat: resolveCliContext helper for multi-repo CLI support"
```

---

### Task 2: Wire `resolveCliContext` into CLI create command

**Files:**
- Modify: `src/features/create/command.ts`
- Test: `src/__tests__/integration.test.ts` (or new `src/__tests__/cli-cross-repo.test.ts`)

**Step 1: Write failing test**

```typescript
describe('CLI create with qualified ID', () => {
  it('creates plan in target repo with dequalified deps', () => {
    const { roots, metaRoot, cleanup } = createCliFixtureWithManifest([
      { alias: 'repo-a', plans: [{ id: 'foundation', title: 'Foundation', status: 'draft' }] },
      { alias: 'repo-b', plans: [] },
    ]);

    // Run from repo-b, create in repo-a
    process.cwd = () => roots.find(r => r.alias === 'repo-b')!.path;
    createCommand('repo-a:new-plan', {
      title: 'New Plan',
      depends_on: ['repo-a:foundation'],
    });

    // Verify plan created in repo-a's plans dir
    const readme = readFileSync(
      join(roots.find(r => r.alias === 'repo-a')!.path, 'plans', 'new-plan', 'README.md'),
      'utf8'
    );
    const fm = matter(readme).data;
    expect(fm.title).toBe('New Plan');
    expect(fm.depends_on).toEqual(['foundation']); // dequalified
    cleanup();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/__tests__/cli-cross-repo.test.ts`
Expected: FAIL

**Step 3: Modify create command**

In `src/features/create/command.ts`, replace `createContext(projectDir)` with `resolveCliContext(projectDir)`. When the ID is qualified:

```typescript
import { resolveCliContext } from '../../core/cli-context.ts';
import { parseQualifiedId, dequalifyDepsForWrite } from '../../core/utils.ts';

export function createCommand(id: string, options: CreateOptions): void {
  const projectDir = process.cwd();
  const ctx = resolveCliContext(projectDir);
  const parsed = parseQualifiedId(id);

  if (parsed.repo) {
    if (!ctx.isMultiRepo) {
      throw new Error(
        'Cross-repo operations require a .trellis-project manifest. '
        + 'Set project_root in .trellis/config to point to your meta-repo.'
      );
    }
    const plansDir = ctx.getPlansDir(parsed.repo);
    const dequalifiedDeps = dequalifyDepsForWrite(options.depends_on, parsed.repo);

    const result = computeCreate({
      id: parsed.planId,
      opts: { ...options, depends_on: dequalifiedDeps },
      plansDir,
      graph: ctx.graph,
      projectDir: ctx.projectDir,
    });
    // output result...
  } else {
    // Existing single-repo path (unchanged)
    const result = computeCreate({
      id, opts: options,
      plansDir: ctx.getPlansDir(),
      graph: ctx.graph,
      projectDir: ctx.projectDir,
    });
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/__tests__/cli-cross-repo.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/features/create/command.ts src/__tests__/cli-cross-repo.test.ts
git commit -m "feat: CLI create supports qualified IDs for cross-repo writes"
```

---

### Task 3: Wire `resolveCliContext` into CLI set and update commands

**Files:**
- Modify: `src/features/set/command.ts`
- Modify: `src/features/update/command.ts`
- Test: `src/__tests__/cli-cross-repo.test.ts`

**Step 1: Write failing tests**

```typescript
describe('CLI set with qualified ID', () => {
  it('updates field on plan in target repo', () => {
    const { roots, cleanup } = createCliFixtureWithManifest([
      { alias: 'repo-a', plans: [{ id: 'plan-1', title: 'Plan 1', status: 'draft', body: '\n## Problem\nText\n' }] },
    ]);
    process.cwd = () => roots[0].path;

    setCommand('repo-a:plan-1', 'description', ['Updated'], {});

    const readme = readFileSync(join(roots[0].path, 'plans', 'plan-1', 'README.md'), 'utf8');
    const fm = matter(readme).data;
    expect(fm.description).toBe('Updated');
    cleanup();
  });
});

describe('CLI update with qualified ID', () => {
  it('transitions status on plan in target repo', () => {
    // Setup: plan with Problem + Approach + implementation.md with Steps, Testing, Done-when
    const { roots, cleanup } = createCliFixtureWithManifest([
      { alias: 'repo-a', plans: [fullySpecifiedPlan('plan-1', 'not_started')] },
    ]);
    process.cwd = () => roots[0].path;

    updateCommand('repo-a:plan-1', 'in_progress', {});

    const readme = readFileSync(join(roots[0].path, 'plans', 'plan-1', 'README.md'), 'utf8');
    const fm = matter(readme).data;
    expect(fm.status).toBe('in_progress');
    cleanup();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/__tests__/cli-cross-repo.test.ts`
Expected: FAIL

**Step 3: Modify set and update commands**

Same pattern as create: replace `createContext` with `resolveCliContext`, use `resolveId` for qualified plan lookup. For `set` and `update`, the plan already exists in the graph so ID resolution works via `resolvePlanId()` — no special routing needed beyond using the multi-repo graph.

Key: these commands use `graph.plans.get(qualifiedId)` to find the plan, which includes `filePath`. The compute functions already use `filePath` to locate the file on disk. So the change is primarily about providing the multi-repo graph.

**Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/__tests__/cli-cross-repo.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/features/set/command.ts src/features/update/command.ts src/__tests__/cli-cross-repo.test.ts
git commit -m "feat: CLI set and update support qualified IDs for cross-repo operations"
```
## Testing
- Unit tests for `resolveCliContext` — multi-repo detection with manifest, single-repo fallback
- Integration: CLI create with qualified ID creates plan in target repo
- Integration: dep dequalification verified on disk for CLI create
- Integration: CLI set with qualified ID modifies plan in target repo
- Integration: CLI update with qualified ID transitions status in target repo
- Integration: error messages for qualified ID in single-repo mode
- Full suite (`npm test`) after each task

Test fixtures need a `createCliFixtureWithManifest` helper that sets up:
- A meta-root directory with `.trellis-project` manifest
- Multiple repo directories with `.trellis/config` pointing `project_root` to meta-root
- Plan fixtures in each repo
## Done-when
- `resolveCliContext()` exists and detects multi-repo mode via manifest
- `trellis create repo:plan-id` creates plans in sibling repos from any repo in the manifest
- `trellis set repo:plan-id` and `trellis update repo:plan-id` operate on plans in sibling repos
- Dep dequalification works identically to MCP path
- Error messages match MCP error messages for consistency
- Single-repo behavior unchanged when no manifest is available
- All existing tests pass unchanged
