
## Steps
### Phase 1: Per-plan mutex utility

**Goal:** Create a lock mechanism and wire it into the MCP server so concurrent writes to the same plan are serialized.

#### Task 1.1: Create `src/core/mutex.ts` with tests

**Files:**
- Create: `src/core/mutex.ts`
- Create: `src/core/mutex.test.ts`

**Step 1: Write failing tests**

Create `src/core/mutex.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createFileLock } from './mutex.ts';

describe('createFileLock', () => {
  it('returns a withLock function', () => {
    const withLock = createFileLock();
    expect(typeof withLock).toBe('function');
  });

  it('executes fn and returns its result', async () => {
    const withLock = createFileLock();
    const result = await withLock('key', () => 42);
    expect(result).toBe(42);
  });

  it('serializes calls on the same key', async () => {
    const withLock = createFileLock();
    const order: number[] = [];

    let resolveFirst!: () => void;
    const firstBlocked = new Promise<void>(r => { resolveFirst = r; });

    const p1 = withLock('same', async () => {
      order.push(1);
      await firstBlocked;
      order.push(2);
      return 'first';
    });

    const p2 = withLock('same', async () => {
      order.push(3);
      return 'second';
    });

    resolveFirst();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe('first');
    expect(r2).toBe('second');
    expect(order).toEqual([1, 2, 3]);
  });

  it('allows parallel calls on different keys', async () => {
    const withLock = createFileLock();
    const order: string[] = [];

    let resolveA!: () => void;
    const aBlocked = new Promise<void>(r => { resolveA = r; });

    const pA = withLock('key-a', async () => {
      order.push('a-start');
      await aBlocked;
      order.push('a-end');
    });

    const pB = withLock('key-b', async () => {
      order.push('b-start');
      order.push('b-end');
    });

    await pB;
    expect(order).toContain('b-start');
    expect(order).toContain('b-end');

    resolveA();
    await pA;
  });

  it('propagates errors without breaking the chain', async () => {
    const withLock = createFileLock();
    await expect(withLock('key', () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const result = await withLock('key', () => 'ok');
    expect(result).toBe('ok');
  });
});
```

**Step 2:** Run `npx vitest run src/core/mutex.test.ts` — expected: FAIL (module not found)

**Step 3: Implement the mutex**

Create `src/core/mutex.ts`:

```typescript
/**
 * Per-key async mutex for serializing operations on shared resources.
 * Used by MCP server to prevent concurrent writes to the same plan.
 */
export function createFileLock(): <T>(key: string, fn: () => T | Promise<T>) => Promise<T> {
  const locks = new Map<string, Promise<void>>();

  return async function withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();

    let release: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    locks.set(key, gate);

    await prev;

    try {
      return await fn();
    } finally {
      release!();
      if (locks.get(key) === gate) {
        locks.delete(key);
      }
    }
  };
}
```

**Step 4:** Run `npx vitest run src/core/mutex.test.ts` — expected: all PASS

**Step 5:** Export from `src/core/index.ts` — add: `export { createFileLock } from './mutex.ts';`

**Step 6:** Commit: `feat: add per-key async mutex for MCP write serialization`

---

#### Task 1.2: Wire mutex into MCP handlers

**Files:**
- Modify: `src/mcp.ts`
- Modify: `src/__tests__/mcp.test.ts`

**Step 1: Write integration tests**

Add to `src/__tests__/mcp.test.ts` (need to add `readFileSync` and `join` imports from existing test patterns):

```typescript
describe('concurrent write safety', () => {
  it('parallel writes to the same file all persist', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\n\n\n## Approach\n\n\n## Notes\n\n\n' },
    ]);
    process.cwd = () => root;
    const server = createMcpServer();

    const [r1, r2, r3] = await Promise.all([
      callTool(server, 'trellis_write_section', {
        plan_id: 'test', file: 'readme', section: 'Problem', content: 'Problem content',
      }),
      callTool(server, 'trellis_write_section', {
        plan_id: 'test', file: 'readme', section: 'Approach', content: 'Approach content',
      }),
      callTool(server, 'trellis_write_section', {
        plan_id: 'test', file: 'readme', section: 'Notes', content: 'Notes content',
      }),
    ]);

    expect(r1.isError).toBeFalsy();
    expect(r2.isError).toBeFalsy();
    expect(r3.isError).toBeFalsy();

    const content = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    expect(content).toContain('Problem content');
    expect(content).toContain('Approach content');
    expect(content).toContain('Notes content');
  });

  it('parallel writes to different files both persist', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\nOld\n',
        implementationMd: '## Steps\nOld\n' },
    ]);
    process.cwd = () => root;
    const server = createMcpServer();

    const [r1, r2] = await Promise.all([
      callTool(server, 'trellis_write_section', {
        plan_id: 'test', file: 'readme', section: 'Problem', content: 'New problem',
      }),
      callTool(server, 'trellis_write_section', {
        plan_id: 'test', file: 'implementation', section: 'Steps', content: 'New steps',
      }),
    ]);

    expect(r1.isError).toBeFalsy();
    expect(r2.isError).toBeFalsy();

    const readme = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    expect(readme).toContain('New problem');

    const impl = readFileSync(join(root, 'plans', 'test', 'implementation.md'), 'utf8');
    expect(impl).toContain('New steps');
  });
});
```

**Step 2:** Run `npx vitest run src/__tests__/mcp.test.ts` — these should pass (sync handlers don't interleave in tests), but they serve as regression tests for the wiring.

**Step 3: Add mutex to `src/mcp.ts`**

Import: `import { createFileLock } from './core/index.ts';`

Inside `createMcpServer()`, after creating the server instance, create the lock:

```typescript
const withLock = createFileLock();
```

Wrap each **write** handler's body in `withLock(plan_id, () => { ... })`. The three tools that need locking:

**`trellis_write_section`** — wrap the try/catch body:
```typescript
async ({ plan_id, file, section, content }) => {
  return withLock(plan_id, () => {
    try {
      const ctx = createContext(process.cwd());
      const result = computeWriteSection(
        { planId: plan_id, file, section, content, graph: ctx.graph },
        { refresh: () => {} },
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });
}
```

**`trellis_set`** — same pattern, wrap with `withLock(plan_id, () => { ... })`

**`trellis_update`** — same pattern, wrap with `withLock(plan_id, () => { ... })`

**`trellis_create`** and **`trellis_read_section`** do NOT need locking (create uses a new plan ID; read is side-effect-free).

**Important:** The `createContext()` call MUST be inside the lock callback so it reads fresh state after any preceding write completes.

**Step 4:** Run full test suite: `npm test` — expected: all pass

**Step 5:** Commit: `feat: serialize MCP writes per plan with async mutex`

---

### Phase 2: Batch write tool

**Goal:** Add `trellis_write_sections` MCP tool for atomic multi-section writes.

#### Task 2.1: Add `computeWriteSections` to `src/features/sections/logic.ts`

**Files:**
- Modify: `src/features/sections/logic.ts`
- Modify: `src/features/sections/sections.test.ts`

**Step 1: Add types to `src/features/sections/logic.ts`**

```typescript
export interface ComputeWriteSectionsOptions {
  planId: string;
  writes: Array<{ file: string; section: string; content: string }>;
  graph: GraphData;
}

export interface WriteSectionsResult {
  id: string;
  writes: Array<{ file: string; section: string }>;
}
```

**Step 2: Write failing tests**

Add to `src/features/sections/sections.test.ts`:

```typescript
describe('computeWriteSections', () => {
  it('writes multiple sections to readme in one pass', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\n\n\n## Approach\n\n\n' },
    ]);
    const ctx = createContext(root);

    const result = computeWriteSections(
      {
        planId: 'test',
        writes: [
          { file: 'readme', section: 'Problem', content: 'New problem' },
          { file: 'readme', section: 'Approach', content: 'New approach' },
        ],
        graph: ctx.graph,
      },
      { refresh: () => {} },
    );

    expect(result.id).toBe('test');
    expect(result.writes).toHaveLength(2);

    const content = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    expect(content).toContain('New problem');
    expect(content).toContain('New approach');
  });

  it('writes to multiple files in one call', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\nOld\n',
        implementationMd: '## Steps\nOld\n' },
    ]);
    const ctx = createContext(root);

    const result = computeWriteSections(
      {
        planId: 'test',
        writes: [
          { file: 'readme', section: 'Problem', content: 'New problem' },
          { file: 'implementation', section: 'Steps', content: 'New steps' },
        ],
        graph: ctx.graph,
      },
      { refresh: () => {} },
    );

    expect(result.writes).toHaveLength(2);

    const readme = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    expect(readme).toContain('New problem');

    const impl = readFileSync(join(root, 'plans', 'test', 'implementation.md'), 'utf8');
    expect(impl).toContain('New steps');
  });

  it('auto-creates inputs and outputs files', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '' },
    ]);
    const ctx = createContext(root);

    computeWriteSections(
      {
        planId: 'test',
        writes: [
          { file: 'inputs', section: 'From plans', content: 'Some input' },
          { file: 'outputs', section: 'Deliverables', content: 'Some output' },
        ],
        graph: ctx.graph,
      },
      { refresh: () => {} },
    );

    const inputs = readFileSync(join(root, 'plans', 'test', 'inputs.md'), 'utf8');
    expect(inputs).toContain('Some input');

    const outputs = readFileSync(join(root, 'plans', 'test', 'outputs.md'), 'utf8');
    expect(outputs).toContain('Some output');
  });

  it('throws for non-existent implementation file', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '' },
    ]);
    const ctx = createContext(root);

    expect(() =>
      computeWriteSections(
        {
          planId: 'test',
          writes: [{ file: 'implementation', section: 'Steps', content: 'stuff' }],
          graph: ctx.graph,
        },
        { refresh: () => {} },
      ),
    ).toThrow(/does not exist/);
  });

  it('throws for invalid file name', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '' },
    ]);
    const ctx = createContext(root);

    expect(() =>
      computeWriteSections(
        {
          planId: 'test',
          writes: [{ file: 'bogus', section: 'X', content: 'Y' }],
          graph: ctx.graph,
        },
        { refresh: () => {} },
      ),
    ).toThrow(/Invalid file/);
  });

  it('throws for remote plan', () => {
    const { root } = createFixture([
      { id: 'remote-plan', title: 'Remote', status: 'draft', repo: 'other-repo', body: '' },
    ]);
    const ctx = createContext(root);

    expect(() =>
      computeWriteSections(
        {
          planId: 'remote-plan',
          writes: [{ file: 'readme', section: 'Problem', content: 'X' }],
          graph: ctx.graph,
        },
        { refresh: () => {} },
      ),
    ).toThrow(/remote/i);
  });
});
```

**Step 3:** Run `npx vitest run src/features/sections/sections.test.ts` — expected: FAIL (function not exported)

**Step 4: Implement `computeWriteSections`**

Add to `src/features/sections/logic.ts`:

```typescript
export function computeWriteSections(
  options: ComputeWriteSectionsOptions,
  callbacks: SectionCallbacks,
): WriteSectionsResult {
  const { planId, writes, graph } = options;

  const plan = graph.plans.get(planId);
  if (!plan) throw new Error(`Plan "${planId}" not found.`);
  if (plan.repoAlias != null) {
    throw new Error(`Cannot modify remote plan '${planId}'. Write operations are local only.`);
  }

  // Validate all file names upfront
  for (const w of writes) {
    if (!FILE_NAME_MAP[w.file]) {
      throw new Error(`Invalid file "${w.file}". Valid files: ${Object.keys(FILE_NAME_MAP).join(', ')}`);
    }
  }

  // Group by file
  const byFile = new Map<string, Array<{ section: string; content: string }>>();
  for (const w of writes) {
    const arr = byFile.get(w.file) ?? [];
    arr.push({ section: w.section, content: w.content });
    byFile.set(w.file, arr);
  }

  const planDir = dirname(plan.filePath);

  for (const [file, sections] of byFile) {
    const fileName = FILE_NAME_MAP[file];
    const filePath = join(planDir, fileName);

    if (fileName === PlanFile.README) {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = matter(raw);
      let body = parsed.content;
      for (const { section, content } of sections) {
        body = writeSection(body, section, content);
      }
      writeFileSync(filePath, matter.stringify(body, parsed.data));
    } else {
      let existing = '';
      if (existsSync(filePath)) {
        existing = readFileSync(filePath, 'utf8');
      } else if (fileName === PlanFile.INPUTS || fileName === PlanFile.OUTPUTS) {
        existing = '';
      } else {
        throw new Error(`File ${fileName} does not exist for plan "${planId}".`);
      }
      let content = existing;
      for (const { section, content: newContent } of sections) {
        content = writeSection(content, section, newContent);
      }
      writeFileSync(filePath, content);
    }
  }

  callbacks.refresh();
  return {
    id: planId,
    writes: writes.map(w => ({ file: w.file, section: w.section })),
  };
}
```

**Step 5:** Run `npx vitest run src/features/sections/sections.test.ts` — expected: all PASS

**Step 6:** Commit: `feat: add computeWriteSections for atomic multi-section writes`

---

#### Task 2.2: Register `trellis_write_sections` MCP tool

**Files:**
- Modify: `src/mcp.ts`
- Modify: `src/__tests__/mcp.test.ts`

**Step 1: Write failing tests**

Add to `src/__tests__/mcp.test.ts`:

```typescript
describe('trellis_write_sections', () => {
  it('writes multiple sections to a plan', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\n\n\n## Approach\n\n\n' },
    ]);
    process.cwd = () => root;
    const server = createMcpServer();

    const result = await callTool(server, 'trellis_write_sections', {
      plan_id: 'test',
      writes: [
        { file: 'readme', section: 'Problem', content: 'Batch problem' },
        { file: 'readme', section: 'Approach', content: 'Batch approach' },
      ],
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text);
    expect(output.id).toBe('test');
    expect(output.writes).toHaveLength(2);

    const content = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    expect(content).toContain('Batch problem');
    expect(content).toContain('Batch approach');
  });

  it('writes to multiple files atomically', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\nOld\n',
        implementationMd: '## Steps\nOld\n## Testing\nOld\n' },
    ]);
    process.cwd = () => root;
    const server = createMcpServer();

    const result = await callTool(server, 'trellis_write_sections', {
      plan_id: 'test',
      writes: [
        { file: 'readme', section: 'Problem', content: 'New problem' },
        { file: 'implementation', section: 'Steps', content: 'Step 1\nStep 2' },
        { file: 'implementation', section: 'Testing', content: 'Test plan' },
      ],
    });

    expect(result.isError).toBeFalsy();

    const readme = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    expect(readme).toContain('New problem');

    const impl = readFileSync(join(root, 'plans', 'test', 'implementation.md'), 'utf8');
    expect(impl).toContain('Step 1\nStep 2');
    expect(impl).toContain('Test plan');
  });

  it('returns error for non-existent plan', async () => {
    const { root } = createFixture([]);
    process.cwd = () => root;
    const server = createMcpServer();

    const result = await callTool(server, 'trellis_write_sections', {
      plan_id: 'nope',
      writes: [{ file: 'readme', section: 'Problem', content: 'X' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });
});
```

**Step 2:** Run `npx vitest run src/__tests__/mcp.test.ts` — expected: FAIL (tool not registered)

**Step 3: Register the tool in `src/mcp.ts`**

Import `computeWriteSections` and its types from `./features/sections/logic.ts`.

Add after the existing `trellis_write_section` tool:

```typescript
server.tool(
  'trellis_write_sections',
  'Write multiple sections to a plan in one atomic operation. Groups writes by file — each file gets a single read-modify-write. Preferred over multiple trellis_write_section calls.',
  {
    plan_id: z.string().describe('Plan ID'),
    writes: z.array(z.object({
      file: z.enum(['readme', 'implementation', 'inputs', 'outputs']).describe('Target file'),
      section: z.string().describe('Section name (## heading)'),
      content: z.string().describe('Markdown content for the section'),
    })).min(1).describe('Section writes to apply'),
  },
  async ({ plan_id, writes }) => {
    return withLock(plan_id, () => {
      try {
        const ctx = createContext(process.cwd());
        const result = computeWriteSections(
          { planId: plan_id, writes, graph: ctx.graph },
          { refresh: () => {} },
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    });
  },
);
```

**Step 4:** Run `npx vitest run src/__tests__/mcp.test.ts` — expected: all PASS

**Step 5:** Run full test suite: `npm test` — expected: all pass

**Step 6:** Commit: `feat: add trellis_write_sections MCP tool for batch writes`

---

### Phase 3: Documentation and wiring

#### Task 3.1: Update `docs/mcp-reference.md`

Add a new section for `trellis_write_sections` following the existing tool documentation pattern (see `trellis_write_section` as template). Include:

- Tool name and description
- Input schema table with parameter, type, required, description columns
- Example request and response
- Note that this is preferred over multiple `trellis_write_section` calls for writing multiple sections

#### Task 3.2: Build and verify

```bash
npm run build
npm test
trellis mcp  # verify server starts without error (Ctrl+C to exit)
```

Commit: `docs: add trellis_write_sections to MCP reference`

## Testing
### Test strategy

**Unit tests:**
- `src/core/mutex.test.ts` — 5 tests: returns function, executes and returns result, serializes same-key calls, allows parallel different-key calls, propagates errors without breaking chain
- `src/features/sections/sections.test.ts` — 6 new tests: multiple sections per file, multiple files per call, auto-creation of inputs/outputs, error cases (missing plan, remote plan, invalid file, missing implementation)

**Integration tests:**
- `src/__tests__/mcp.test.ts` — 5 new tests: parallel writes to same file all persist, parallel writes to different files both persist, batch write multiple sections, batch write multiple files, error on non-existent plan

**Note on race condition testing:** The race condition requires MCP transport-level concurrency (multiple JSON-RPC messages dispatched without awaiting each handler). In unit tests, `Promise.all` over sync handlers executes sequentially — the race doesn't manifest. The mutex unit tests prove the locking mechanism works; the integration tests serve as regression tests for the wiring. The real fix is the `await withLock()` in each handler, which introduces yield points that the MCP SDK's message dispatcher needs to properly serialize.

### Commands

```bash
npx vitest run src/core/mutex.test.ts                  # mutex unit tests
npx vitest run src/features/sections/sections.test.ts   # batch write tests
npx vitest run src/__tests__/mcp.test.ts                # MCP integration tests
npm test                                                 # full suite
```

## Done-when
- [ ] `src/core/mutex.ts` exists with `createFileLock()` function, exported from `src/core/index.ts`
- [ ] Mutex has 5 unit tests covering serialization, parallelism, error propagation
- [ ] `trellis_write_section`, `trellis_set`, and `trellis_update` MCP handlers wrap their bodies in `withLock(plan_id, ...)`
- [ ] `createContext()` is called INSIDE the lock callback (not before) so it reads fresh state
- [ ] `computeWriteSections()` function in `src/features/sections/logic.ts` groups writes by file, does one read-modify-write per file
- [ ] `trellis_write_sections` MCP tool registered with Zod schema and wrapped in `withLock`
- [ ] MCP tests verify batch writes (3 tests) and concurrent write safety (2 tests)
- [ ] `docs/mcp-reference.md` documents the new `trellis_write_sections` tool
- [ ] Full test suite passes (`npm test`)
- [ ] Build succeeds (`npm run build`)
