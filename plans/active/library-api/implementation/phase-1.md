# Phase 1: Library Core — Extract, Export, Build

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Create `src/index.ts` that re-exports all public API from existing modules, add an esbuild library target that emits ESM + CJS + `.d.ts`, and verify the build works without breaking the existing CLI.

**Architecture:** The existing code already has clean module boundaries (`scanner.ts`, `graph.ts`, `frontmatter.ts`, `contracts.ts`, `types.ts`, `utils.ts`). We create a barrel export file and a parallel build target. The CLI build remains unchanged; the library build adds a second esbuild entry point producing `dist/index.mjs` (ESM) + `dist/index.cjs` (CJS), and we use `tsc` for `.d.ts` generation.

**Tech Stack:** TypeScript, esbuild, tsc (declarations only)

**Related:** [./phase-2.md](./phase-2.md), [./phase-3.md](./phase-3.md), [../README.md](../README.md)

---

## Context

Currently trellis is a CLI-only tool. The source modules (`scanner.ts`, `graph.ts`, etc.) contain pure functions with no `process.cwd()` or `console.log` calls — those live exclusively in `src/commands/*.ts` and `src/cli.ts`. This clean separation means we can export the core modules as-is.

The existing build produces one artifact: `dist/trellis.cjs` (CLI binary with shebang). We need to add a library artifact alongside it without disturbing the CLI build.

---

### Task 1: Create the barrel export file

**Files:**
- Create: `src/index.ts`
- Reference: `src/types.ts`, `src/scanner.ts`, `src/graph.ts`, `src/frontmatter.ts`, `src/contracts.ts`, `src/utils.ts`

**Step 1: Write the failing test**

Create a test that imports from the future barrel export and checks that key symbols exist.

```typescript
// tests/index.test.ts
import { describe, it, expect } from 'vitest';

describe('library exports', () => {
  it('exports core types', async () => {
    const lib = await import('../src/index.ts');
    // Types are compile-time only, but type-narrowing constants should be present
    expect(lib.VALID_STATUSES).toEqual(['draft', 'not_started', 'in_progress', 'done', 'archived']);
  });

  it('exports scanner functions', async () => {
    const lib = await import('../src/index.ts');
    expect(typeof lib.scanPlans).toBe('function');
    expect(typeof lib.loadConfig).toBe('function');
    expect(typeof lib.derivePlanId).toBe('function');
  });

  it('exports graph functions', async () => {
    const lib = await import('../src/index.ts');
    expect(typeof lib.buildGraph).toBe('function');
    expect(typeof lib.detectCycles).toBe('function');
    expect(typeof lib.topologicalSort).toBe('function');
    expect(typeof lib.transitiveDependents).toBe('function');
    expect(typeof lib.computeCriticalPath).toBe('function');
    expect(typeof lib.pickNext).toBe('function');
    expect(typeof lib.computeChunks).toBe('function');
    expect(typeof lib.newlyReady).toBe('function');
  });

  it('exports frontmatter functions', async () => {
    const lib = await import('../src/index.ts');
    expect(typeof lib.parseFrontmatter).toBe('function');
    expect(typeof lib.validateFrontmatter).toBe('function');
    expect(typeof lib.readPlanFile).toBe('function');
    expect(typeof lib.updatePlanFile).toBe('function');
  });

  it('exports contract functions', async () => {
    const lib = await import('../src/index.ts');
    expect(typeof lib.parseInputs).toBe('function');
    expect(typeof lib.parseOutputs).toBe('function');
  });

  it('exports utility functions', async () => {
    const lib = await import('../src/index.ts');
    expect(typeof lib.filterPlans).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/index.test.ts`
Expected: FAIL — module `../src/index.ts` does not exist

**Step 3: Write the barrel export**

```typescript
// src/index.ts

// --- Types ---
export type {
  PlanStatus,
  PlanFrontmatter,
  ContractSection,
  PlanContract,
  Plan,
  TrellisConfig,
  ValidationError,
} from './types.ts';

// --- Scanner ---
export { scanPlans, loadConfig, derivePlanId } from './scanner.ts';

// --- Graph ---
export type {
  GraphData,
  Cycle,
  ChunkPlan,
  ChunkEdge,
  CrossChunkEdge,
  ChunkBoundaryItem,
  Chunk,
  ChunkResult,
} from './graph.ts';

export {
  buildGraph,
  detectCycles,
  topologicalSort,
  transitiveDependents,
  computeCriticalPath,
  pickNext,
  computeChunks,
  groupByDirectory,
  groupByTopologicalDepth,
  chunkContractAggregation,
  newlyReady,
} from './graph.ts';

// --- Frontmatter ---
export {
  parseFrontmatter,
  validateFrontmatter,
  readPlanFile,
  updatePlanFile,
} from './frontmatter.ts';

// --- Contracts ---
export { parseInputs, parseOutputs } from './contracts.ts';

// --- Utilities ---
export { VALID_STATUSES, filterPlans } from './utils.ts';
```

> **Intentionally excluded exports:**
> - `graph.ts` internal chunk-building helpers: `agglomerativeMerge`, `applyOverrides`, `assignOrphans`, `buildChunkObjects`, `computeDepths`, `interfaceWidthSplit` — implementation details, not public API
> - `utils.ts` CLI formatting helpers: `padRight`, `pluralize`, `computeColumnWidth`, `formatLines` — presentation-layer code, not relevant for library consumers

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: add barrel export for library API"
```

---

### Task 2: Add library build target to esbuild

**Files:**
- Modify: `build.mjs`
- Modify: `package.json`
- Modify: `tsconfig.json`

**Step 1: Write the failing test**

```typescript
// tests/build.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

describe('library build', () => {
  beforeAll(() => {
    execSync('node build.mjs', { cwd: resolve(__dirname, '..') });
  });

  it('produces ESM and CJS library bundles', () => {
    expect(existsSync(resolve(__dirname, '../dist/index.mjs'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../dist/index.cjs'))).toBe(true);
  });

  it('ESM bundle exports expected symbols', async () => {
    const lib = await import(resolve(__dirname, '../dist/index.mjs'));
    expect(typeof lib.scanPlans).toBe('function');
    expect(typeof lib.buildGraph).toBe('function');
    expect(typeof lib.loadConfig).toBe('function');
    expect(typeof lib.Trellis).toBe('function');
  });

  it('CJS bundle exports expected symbols', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lib = require(resolve(__dirname, '../dist/index.cjs'));
    expect(typeof lib.scanPlans).toBe('function');
    expect(typeof lib.buildGraph).toBe('function');
    expect(typeof lib.loadConfig).toBe('function');
    expect(typeof lib.Trellis).toBe('function');
  });

  it('CLI binary still works', () => {
    expect(existsSync(resolve(__dirname, '../dist/trellis.cjs'))).toBe(true);
    const output = execSync('node dist/trellis.cjs --help', { cwd: resolve(__dirname, '..') }).toString();
    expect(output).toContain('trellis');
  });

  it('type declarations contain expected exports', () => {
    const dts = readFileSync(resolve(__dirname, '../dist/index.d.ts'), 'utf8');
    // Core types
    expect(dts).toContain('Plan');
    expect(dts).toContain('PlanStatus');
    expect(dts).toContain('TrellisConfig');
    // Functions
    expect(dts).toContain('scanPlans');
    expect(dts).toContain('buildGraph');
    expect(dts).toContain('loadConfig');
    // High-level API (after Phase 2)
    expect(dts).toContain('Trellis');
    expect(dts).toContain('StatusResult');
    expect(dts).toContain('ReadyResult');
    expect(dts).toContain('ShowResult');
    expect(dts).toContain('UpdateResult');
    expect(dts).toContain('LintResult');
    expect(dts).toContain('GraphResult');
    expect(dts).toContain('EpicResult');
  });

  it('package.json exports point to existing files', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    expect(pkg.main).toBe('./dist/index.cjs');
    expect(pkg.module).toBe('./dist/index.mjs');
    expect(pkg.types).toBe('./dist/index.d.ts');
    expect(pkg.exports['.']).toBeDefined();
    expect(pkg.exports['.'].import).toBe('./dist/index.mjs');
    expect(pkg.exports['.'].require).toBe('./dist/index.cjs');
    expect(pkg.exports['.'].types).toBe('./dist/index.d.ts');
    // Verify all referenced files exist
    expect(existsSync(resolve(__dirname, '..', pkg.main))).toBe(true);
    expect(existsSync(resolve(__dirname, '..', pkg.module))).toBe(true);
    expect(existsSync(resolve(__dirname, '..', pkg.types))).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/build.test.ts`
Expected: FAIL — `dist/index.mjs` does not exist

**Step 3: Modify build.mjs to add library targets**

Add these two additional builds after the existing CLI build in `build.mjs`:

```javascript
// --- Library ESM build (no shebang, no viewer) ---
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.mjs',
  external: [],
  minify: process.argv.includes('--minify'),
});

// --- Library CJS build ---
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/index.cjs',
  external: [],
  minify: process.argv.includes('--minify'),
});
```

**Step 4: Update package.json exports**

Add `exports`, `main`, `module`, and `types` fields to `package.json`:

```json
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"]
}
```

Keep existing `"bin"` field as-is.

**Step 5: Add tsconfig for declaration generation**

Create `tsconfig.lib.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "dist",
    "noEmit": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/cli.ts", "src/commands/**"]
}
```

> **Why glob instead of listing files:** New modules (like `src/api.ts` in Phase 2) are automatically included. The exclude list is stable — CLI entry point and command formatters are the only non-library code.

Add a `build:types` script and update `build` to run both:

```json
{
  "scripts": {
    "build": "node build.mjs && tsc -p tsconfig.lib.json",
    "build:prod": "node build.mjs --minify && tsc -p tsconfig.lib.json",
    "test": "vitest run",
    "dev": "vitest"
  }
}
```

**Step 6: Run test to verify it passes**

Run: `npm test -- tests/build.test.ts`
Expected: PASS

**Step 7: Verify existing tests still pass**

Run: `npm test`
Expected: All existing tests PASS

**Step 8: Commit**

```bash
git add build.mjs package.json tsconfig.lib.json tests/build.test.ts
git commit -m "feat: add library build targets (ESM + CJS + .d.ts)"
```

---

### Task 3: Verify the library export surface is complete and usable

This is a smoke test that uses the library API end-to-end: load config, scan plans, build graph, query results — all via the library exports rather than CLI commands.

**Files:**
- Create: `tests/library-integration.test.ts`
- Reference: `tests/helpers.ts` (for creating temp plan directories)

**Step 1: Write the integration test**

```typescript
// tests/library-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfig,
  scanPlans,
  buildGraph,
  detectCycles,
  topologicalSort,
  pickNext,
  computeChunks,
  computeCriticalPath,
  transitiveDependents,
  validateFrontmatter,
  filterPlans,
  newlyReady,
  VALID_STATUSES,
} from '../src/index.ts';

describe('library API integration', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `trellis-lib-test-${Date.now()}`);
    plansDir = join(tmpDir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePlan(id: string, frontmatter: Record<string, unknown>) {
    const fm = Object.entries(frontmatter)
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - ${i}`).join('\n')}`;
        return `${k}: ${v}`;
      })
      .join('\n');
    const dir = join(plansDir, ...id.split('/').slice(0, -1));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(plansDir, `${id}.md`), `---\n${fm}\n---\n\nPlan body for ${id}\n`);
  }

  it('loads config from directory', () => {
    const config = loadConfig(tmpDir);
    expect(config.project).toBe('test-project');
    expect(config.plans_dir).toBe('plans');
  });

  it('scans plans and builds graph', () => {
    writePlan('foundation', { title: 'Foundation', status: 'done' });
    writePlan('feature-a', { title: 'Feature A', status: 'not_started', depends_on: ['foundation'] });
    writePlan('feature-b', { title: 'Feature B', status: 'not_started', depends_on: ['foundation'] });

    const plans = scanPlans(plansDir);
    expect(plans).toHaveLength(3);

    const graph = buildGraph(plans);
    expect(graph.ready.has('feature-a')).toBe(true);
    expect(graph.ready.has('feature-b')).toBe(true);
    expect(graph.blocked.size).toBe(0);
  });

  it('computes critical path', () => {
    writePlan('a', { title: 'A', status: 'done' });
    writePlan('b', { title: 'B', status: 'done', depends_on: ['a'] });
    writePlan('c', { title: 'C', status: 'not_started', depends_on: ['b'] });

    const plans = scanPlans(plansDir);
    const graph = buildGraph(plans);
    const path = computeCriticalPath('c', graph);
    expect(path).toEqual(['a', 'b', 'c']);
  });

  it('picks next plan', () => {
    writePlan('a', { title: 'A', status: 'not_started' });
    writePlan('b', { title: 'B', status: 'not_started' });

    const plans = scanPlans(plansDir);
    const graph = buildGraph(plans);
    const next = pickNext(graph);
    expect(next).toBeTruthy();
    expect(['a', 'b']).toContain(next);
  });

  it('detects newly ready plans', () => {
    writePlan('dep', { title: 'Dep', status: 'not_started' });
    writePlan('child', { title: 'Child', status: 'not_started', depends_on: ['dep'] });

    const plans = scanPlans(plansDir);
    const graph = buildGraph(plans);

    const ready = newlyReady('dep', 'done', graph);
    expect(ready).toEqual(['child']);
  });

  it('filters plans by tag and repo', () => {
    writePlan('tagged', { title: 'Tagged', status: 'not_started', tags: ['core'], repo: 'public' });
    writePlan('other', { title: 'Other', status: 'not_started', tags: ['extra'], repo: 'private' });

    const plans = scanPlans(plansDir);
    expect(filterPlans(plans, { tag: 'core' })).toHaveLength(1);
    expect(filterPlans(plans, { repo: 'public' })).toHaveLength(1);
    expect(filterPlans(plans, { tag: 'core', repo: 'public' })).toHaveLength(1);
    expect(filterPlans(plans, { tag: 'core', repo: 'private' })).toHaveLength(0);
  });

  it('computes chunks', () => {
    writePlan('contracts/types', { title: 'Types', status: 'done' });
    writePlan('contracts/api', { title: 'API', status: 'not_started', depends_on: ['contracts/types'] });
    writePlan('impl/core', { title: 'Core', status: 'not_started', depends_on: ['contracts/types'] });

    const plans = scanPlans(plansDir);
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    expect(result.chunks.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npm test -- tests/library-integration.test.ts`
Expected: PASS — this validates the barrel export works for real usage

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add tests/library-integration.test.ts
git commit -m "test: add library API integration tests"
```

---

### Task 4: Built artifact integration tests

The library API will be consumed by Electron via `import` or `require` from the built package, not from TypeScript source. This test validates that the built artifacts work end-to-end: create a Trellis instance from the ESM bundle, run a full workflow, and verify results. This catches build config issues (missing exports, broken bundling, tree-shaking stripping needed code) that source-level tests cannot.

**Files:**
- Create: `tests/dist-integration.test.ts`
- Modify: `package.json` (add `test:dist` script)

**Step 1: Add a separate test script**

The built artifact tests require a build to have been run first. Add a `test:dist` script that runs just these tests:

```json
{
  "scripts": {
    "test:dist": "npm run build && vitest run tests/dist-integration.test.ts"
  }
}
```

**Step 2: Write the built artifact integration test**

```typescript
// tests/dist-integration.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// Import from built ESM bundle — this is what Electron consumers see
const distPath = resolve(__dirname, '../dist/index.mjs');

describe('built artifact integration', () => {
  let lib: any;

  beforeAll(async () => {
    // Ensure build exists
    if (!existsSync(distPath)) {
      execSync('node build.mjs', { cwd: resolve(__dirname, '..') });
    }
    lib = await import(distPath);
  });

  function createTestProject(plans: Record<string, Record<string, unknown>> = {}) {
    const tmpDir = join(tmpdir(), `trellis-dist-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const plansDir = join(tmpDir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(tmpDir, '.trellis'), 'project: dist-test\nplans_dir: plans\n');

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

  let tmpDir: string;

  beforeEach(() => {
    const project = createTestProject({
      'foundation':  { title: 'Foundation', status: 'done' },
      'feature-a':   { title: 'Feature A', status: 'not_started', depends_on: ['foundation'], tags: ['core'] },
      'feature-b':   { title: 'Feature B', status: 'not_started', depends_on: ['feature-a'] },
    });
    tmpDir = project.tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Trellis class is constructable and functional from ESM bundle', () => {
    const t = new lib.Trellis(tmpDir);
    expect(t.config.project).toBe('dist-test');

    const status = t.status({ showDone: true });
    expect(status.total).toBe(3);
    expect(status.byStatus.done).toHaveLength(1);
    expect(status.byStatus.ready).toHaveLength(1);
    expect(status.byStatus.blocked).toHaveLength(1);
  });

  it('full workflow: status → ready → update → verify unblock', () => {
    const t = new lib.Trellis(tmpDir);

    // Ready should include feature-a
    const ready = t.ready();
    expect(ready.plans.map((p: any) => p.id)).toContain('feature-a');
    expect(ready.next).toBe('feature-a');

    // feature-b is blocked
    const showB = t.show('feature-b');
    expect(showB.blocked).toBe(true);

    // Complete feature-a
    const updateResult = t.update('feature-a', 'done');
    expect(updateResult.previousStatus).toBe('not_started');
    expect(updateResult.newlyReady).toContain('feature-b');

    // feature-b is now ready
    expect(t.show('feature-b').ready).toBe(true);
  });

  it('low-level functions are accessible from bundle', () => {
    expect(typeof lib.scanPlans).toBe('function');
    expect(typeof lib.buildGraph).toBe('function');
    expect(typeof lib.loadConfig).toBe('function');
    expect(typeof lib.parseFrontmatter).toBe('function');
    expect(typeof lib.filterPlans).toBe('function');
    expect(typeof lib.VALID_STATUSES).toBe('object');
    expect(lib.VALID_STATUSES).toContain('done');
  });

  it('CJS require also works', () => {
    const cjsLib = require(resolve(__dirname, '../dist/index.cjs'));
    const t = new cjsLib.Trellis(tmpDir);
    expect(t.config.project).toBe('dist-test');
    expect(t.status({ showDone: true }).total).toBe(3);
  });
});
```

**Step 3: Run the test**

Run: `npm run test:dist`
Expected: PASS

**Step 4: Commit**

```bash
git add tests/dist-integration.test.ts package.json
git commit -m "test: add built artifact integration tests for ESM and CJS bundles"
```
