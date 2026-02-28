## Steps
### Task 1: Create `dequalifyDepsForWrite` utility

**Files:**
- Modify: `src/core/utils.ts` (add function after `parseQualifiedId` at line ~49)
- Test: `src/__tests__/utils.test.ts`

**Step 1: Write failing tests**

```typescript
import { dequalifyDepsForWrite } from '../core/utils.ts';

describe('dequalifyDepsForWrite', () => {
  it('strips same-repo qualification', () => {
    const deps = ['infra-terraform:tf-gcp-foundation'];
    const result = dequalifyDepsForWrite(deps, 'infra-terraform');
    expect(result).toEqual(['tf-gcp-foundation']);
  });

  it('preserves cross-repo qualification', () => {
    const deps = ['acorn-cloud:cloud-api'];
    const result = dequalifyDepsForWrite(deps, 'infra-terraform');
    expect(result).toEqual(['acorn-cloud:cloud-api']);
  });

  it('preserves already-unqualified deps', () => {
    const deps = ['tf-gcp-foundation'];
    const result = dequalifyDepsForWrite(deps, 'infra-terraform');
    expect(result).toEqual(['tf-gcp-foundation']);
  });

  it('handles mixed deps', () => {
    const deps = ['infra-terraform:tf-gcp-foundation', 'acorn-cloud:cloud-api', 'local-plan'];
    const result = dequalifyDepsForWrite(deps, 'infra-terraform');
    expect(result).toEqual(['tf-gcp-foundation', 'acorn-cloud:cloud-api', 'local-plan']);
  });

  it('returns empty array for empty input', () => {
    expect(dequalifyDepsForWrite([], 'infra-terraform')).toEqual([]);
  });

  it('returns undefined for undefined input', () => {
    expect(dequalifyDepsForWrite(undefined, 'infra-terraform')).toBeUndefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/__tests__/utils.test.ts`
Expected: FAIL — `dequalifyDepsForWrite` is not exported.

**Step 3: Implement `dequalifyDepsForWrite`**

Add to `src/core/utils.ts` after `parseQualifiedId`:

```typescript
/**
 * Dequalify deps for writing to disk. Same-repo deps get stripped to bare IDs;
 * cross-repo deps stay qualified. Inverse of qualifyPlan() at read time.
 */
export function dequalifyDepsForWrite(
  deps: string[] | undefined,
  targetAlias: string
): string[] | undefined {
  if (!deps) return undefined;
  return deps.map(dep => {
    const parsed = parseQualifiedId(dep);
    if (parsed.repo === targetAlias) return parsed.planId;
    return dep;
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/__tests__/utils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/utils.ts src/__tests__/utils.test.ts
git commit -m "feat: add dequalifyDepsForWrite utility"
```

---

### Task 2: Wire dequalification into MCP create handler

**Files:**
- Modify: `src/mcp.ts` (create handler at lines ~302-356)
- Test: `src/__tests__/mcp.test.ts`

**Step 1: Write failing test**

Add a multi-repo fixture test. The test needs a multi-repo setup with two repos:

```typescript
import { createMultiRepoFixture } from './helpers.ts';

describe('trellis_create cross-repo dep dequalification', () => {
  it('dequalifies same-repo deps on disk', async () => {
    // Setup: two repos, repo-a has an existing plan
    const { roots, cleanup } = createMultiRepoFixture([
      { alias: 'repo-a', plans: [{ id: 'foundation', title: 'Foundation', status: 'draft' }] },
      { alias: 'repo-b', plans: [] },
    ]);

    const server = createMcpServer({ repos: roots });
    await callTool(server, 'trellis_create', {
      id: 'repo-a:new-plan',
      title: 'New Plan',
      depends_on: ['repo-a:foundation', 'repo-b:other'],
    });

    // Read the on-disk frontmatter
    const readme = readFileSync(join(roots[0].path, 'plans', 'new-plan', 'README.md'), 'utf8');
    const fm = matter(readme).data;
    // Same-repo dep should be dequalified, cross-repo dep preserved
    expect(fm.depends_on).toEqual(['foundation', 'repo-b:other']);

    cleanup();
  });
});
```

Note: `createMultiRepoFixture` may need to be created in `helpers.ts` if it doesn't exist — check existing multi-repo test helpers first.

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/__tests__/mcp.test.ts -t 'dequalifies same-repo deps'`
Expected: FAIL — deps written as-is without dequalification.

**Step 3: Wire dequalification into MCP create handler**

In `src/mcp.ts`, in the `trellis_create` handler, after resolving `writeAlias` and before calling `computeCreate`, dequalify the deps:

```typescript
// After line ~329 where writeAlias is set:
const dequalifiedDeps = dequalifyDepsForWrite(depends_on, writeAlias);

// Pass dequalifiedDeps instead of depends_on to computeCreate:
const result = computeCreate({
  id: localId,
  opts: { title, description, depends_on: dequalifiedDeps, tags, type: resolvedType },
  plansDir, graph: ctx.graph, projectDir
});
```

Import `dequalifyDepsForWrite` from `./core/utils.ts`.

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/__tests__/mcp.test.ts -t 'dequalifies same-repo deps'`
Expected: PASS

**Step 5: Commit**

```bash
git add src/mcp.ts src/__tests__/mcp.test.ts
git commit -m "feat: dequalify same-repo deps in MCP create handler"
```

---

### Task 3: Add error messages for missing manifest and missing repo alias

**Files:**
- Modify: `src/mcp.ts` (create handler)
- Test: `src/__tests__/mcp.test.ts`

**Step 1: Write failing tests**

```typescript
describe('cross-repo create error messages', () => {
  it('errors with guidance when repo alias not found', async () => {
    const { roots, cleanup } = createMultiRepoFixture([
      { alias: 'repo-a', plans: [] },
    ]);
    const server = createMcpServer({ repos: roots });

    const result = await callTool(server, 'trellis_create', {
      id: 'nonexistent:new-plan',
      title: 'New Plan',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found in manifest');
    expect(result.content[0].text).toContain('.trellis-project');
    cleanup();
  });

  it('errors with guidance when no manifest available', async () => {
    // Single-repo mode, no manifest
    const { root } = createFixture([]);
    process.cwd = () => root;
    const server = createMcpServer();

    const result = await callTool(server, 'trellis_create', {
      id: 'some-repo:new-plan',
      title: 'New Plan',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('project_root');
    cleanup();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/__tests__/mcp.test.ts -t 'cross-repo create error'`
Expected: FAIL — current errors are generic.

**Step 3: Add descriptive error messages**

In the MCP `trellis_create` handler:

```typescript
if (ctx.isMultiRepo) {
  const parsed = parseQualifiedId(id);
  if (!parsed.repo) {
    throw new Error('In multi-repo mode, plan ID must be qualified (alias:planId).');
  }
  try {
    plansDir = ctx.getPlansDir(parsed.repo);
  } catch {
    throw new Error(
      `Repo "${parsed.repo}" not found in manifest. Add it to .trellis-project.`
    );
  }
  // ...
} else {
  // Single-repo mode — qualified ID means they want cross-repo
  const parsed = parseQualifiedId(id);
  if (parsed.repo) {
    throw new Error(
      'Cross-repo operations require a .trellis-project manifest. '
      + 'Set project_root in .trellis/config to point to your meta-repo.'
    );
  }
  // ...
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/__tests__/mcp.test.ts -t 'cross-repo create error'`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/mcp.ts src/__tests__/mcp.test.ts
git commit -m "feat: descriptive error messages for cross-repo create failures"
```
## Testing
- Unit tests for `dequalifyDepsForWrite` — all edge cases (same-repo, cross-repo, unqualified, mixed, empty, undefined)
- Integration test: multi-repo MCP create with dep dequalification verified on disk
- Integration test: error message when repo alias not in manifest
- Integration test: error message when no manifest in single-repo mode
- Run full suite (`npm test`) after each task to prevent regressions
## Done-when
- `dequalifyDepsForWrite()` exists in `src/core/utils.ts` with full test coverage
- MCP `trellis_create` dequalifies same-repo deps before writing to disk
- Cross-repo deps are preserved as qualified in on-disk frontmatter
- Error messages guide users to add missing repos to manifest or set up `project_root`
- All existing tests pass unchanged
- New tests cover all three tasks
