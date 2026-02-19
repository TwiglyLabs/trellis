# Phase 4: File Watching & Electron-Ready Reactive API

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Add a `watch()` method to the `Trellis` class that uses `fs.watch` to monitor the plans directory and emit events when plans change. This is the key "native library advantage" — an Electron app can subscribe to changes and re-render the graph without polling.

**Architecture:** `Trellis.watch()` starts a recursive `fs.watch` on the plans directory, debounces changes, calls `refresh()`, and emits a `'change'` event with the updated graph data. Uses Node's built-in `EventEmitter`. `Trellis.unwatch()` stops the watcher. No new dependencies.

**Tech Stack:** TypeScript, Node `fs.watch`, `EventEmitter`

**Related:** [./phase-2.md](./phase-2.md), [./phase-3.md](./phase-3.md), [../README.md](../README.md)

---

## Design Notes

### Why EventEmitter and not callbacks?

The Electron app may have multiple listeners (graph view, status bar, notification system). EventEmitter is the natural Node pattern and Electron's IPC bridges work well with it.

### Platform note: `fs.watch({ recursive: true })`

`fs.watch` with `{ recursive: true }` is reliable on macOS and Windows but had limited support on Linux prior to Node 19. If the Electron app targets Linux, verify minimum Node >= 19 or implement a fallback (flat watchers per subdirectory, or chokidar). For now, we target macOS/Windows (Electron's primary platforms) and document the Node >= 19 requirement for Linux.

### Debouncing

File saves often produce multiple `fs.watch` events (write, rename, etc). We debounce with a 100ms window so the consumer gets one `'change'` event per logical edit, not a flood.

### What the change event carries

The `'change'` event emits the full `GraphResult` (same as `t.graph()`). This is the data the Electron renderer needs to repaint the DAG. The consumer can also call `t.status()` or any other method after receiving the event — the cache is already fresh.

---

### Task 1: Make Trellis extend EventEmitter and add watch/unwatch

**Files:**
- Modify: `src/api.ts`
- Create: `tests/api-watch.test.ts`

**CI Note:** The watch tests are inherently timing-dependent (they wait for filesystem events). To prevent CI flakiness:
- Use a retry/poll helper instead of fixed `setTimeout` delays where possible
- Set generous timeouts (5s) for event expectations
- If tests prove flaky in CI, gate them behind `describe.skipIf(process.env.CI)` and document that they run locally only. The watch feature is validated by manual testing against a real Electron consumer; the unit tests verify the wiring, not the OS-level fs.watch behavior.

**Step 1: Write the failing test**

```typescript
// tests/api-watch.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Trellis } from '../src/api.ts';

function createTestProject() {
  const tmpDir = join(tmpdir(), `trellis-watch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const plansDir = join(tmpDir, 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');
  return { tmpDir, plansDir };
}

function writePlan(plansDir: string, id: string, frontmatter: Record<string, unknown>) {
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

describe('Trellis.watch()', () => {
  let tmpDir: string;
  let plansDir: string;
  let trellis: Trellis;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
    writePlan(plansDir, 'initial', { title: 'Initial', status: 'not_started' });
    trellis = new Trellis(tmpDir);
  });

  afterEach(() => {
    trellis.unwatch();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits change event when a plan file is modified', async () => {
    const changePromise = new Promise<any>((resolve) => {
      trellis.on('change', resolve);
    });

    trellis.watch();

    // Modify a plan file
    await new Promise(r => setTimeout(r, 50)); // let watcher initialize
    writePlan(plansDir, 'new-plan', { title: 'New Plan', status: 'not_started' });

    const result = await Promise.race([
      changePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('unwatch stops watching', async () => {
    let changeCount = 0;
    trellis.on('change', () => changeCount++);

    trellis.watch();
    await new Promise(r => setTimeout(r, 50));

    trellis.unwatch();

    writePlan(plansDir, 'after-unwatch', { title: 'After', status: 'not_started' });
    await new Promise(r => setTimeout(r, 300));

    expect(changeCount).toBe(0);
  });

  it('isWatching reflects state', () => {
    expect(trellis.isWatching).toBe(false);
    trellis.watch();
    expect(trellis.isWatching).toBe(true);
    trellis.unwatch();
    expect(trellis.isWatching).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/api-watch.test.ts`
Expected: FAIL — `watch`, `unwatch`, `isWatching`, `on` not defined

**Step 3: Implement watch/unwatch**

Make `Trellis` extend `EventEmitter`:

```typescript
import { EventEmitter } from 'events';
import { watch as fsWatch, type FSWatcher } from 'fs';

export class Trellis extends EventEmitter {
  // ... existing fields ...
  private _watcher: FSWatcher | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  get isWatching(): boolean {
    return this._watcher !== null;
  }

  watch(debounceMs = 100): void {
    if (this._watcher) return; // already watching

    const plansDir = join(this.projectDir, this.config.plans_dir);
    this._watcher = fsWatch(plansDir, { recursive: true }, (_event, _filename) => {
      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => {
        this.refresh();
        this.emit('change', this.graph());
      }, debounceMs);
    });

    this._watcher.on('error', (err) => {
      this.emit('error', err);
    });
  }

  unwatch(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
  }
}
```

**Step 4: Run tests**

Run: `npm test -- tests/api-watch.test.ts`
Expected: PASS

**Step 5: Run full suite**

Run: `npm test`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/api.ts tests/api-watch.test.ts
git commit -m "feat: add Trellis.watch() for reactive file monitoring"
```

---

### Task 2: Export watch-related types from barrel

**Files:**
- Modify: `src/index.ts`

**Step 1: Verify the Trellis class (which now extends EventEmitter) is already exported**

The barrel already exports `Trellis`. Since `watch()`, `unwatch()`, and `isWatching` are public methods on the class, they're automatically available. No new types needed.

**Step 2: Run tests**

Run: `npm test`
Expected: All PASS

**Step 3: Commit (if any changes needed)**

```bash
git add src/index.ts
git commit -m "chore: verify watch API exported from barrel"
```
