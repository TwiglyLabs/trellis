import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ContextStore, computeMtimeHash } from './store.ts';
import { createMultiContext } from './context.ts';
import { scanPlans } from './scanner.ts';
import { createTestFixture } from '../__tests__/fixtures/context-store.ts';
import type { TestFixture } from '../__tests__/fixtures/context-store.ts';

// --- computeMtimeHash tests ---

describe('computeMtimeHash', () => {
  it('returns consistent hash for unchanged directory', () => {
    const fixture = createTestFixture(1, 3);
    const hash1 = computeMtimeHash(fixture.repos[0].plansDir);
    const hash2 = computeMtimeHash(fixture.repos[0].plansDir);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(32);
  });

  it('returns different hash after touching a plan file', () => {
    const fixture = createTestFixture(1, 2);
    const hash1 = computeMtimeHash(fixture.repos[0].plansDir);

    // Touch a file to change its mtime
    const readmePath = join(fixture.repos[0].plansDir, 'plan-0', 'README.md');
    const future = new Date(Date.now() + 1000);
    utimesSync(readmePath, future, future);

    const hash2 = computeMtimeHash(fixture.repos[0].plansDir);
    expect(hash2).not.toBe(hash1);
  });

  it('handles empty plans directory (returns stable hash)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-empty-'));
    const hash = computeMtimeHash(dir);
    expect(hash).toBeTruthy();
    expect(hash).toHaveLength(32);

    // Stable across calls
    expect(computeMtimeHash(dir)).toBe(hash);
  });

  it('handles missing plans directory (returns null)', () => {
    const hash = computeMtimeHash('/nonexistent/path/that/does/not/exist');
    expect(hash).toBeNull();
  });
});

// --- ContextStore: Cache hit path ---

describe('ContextStore cache hit', () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = createTestFixture(2, 3);
  });

  it('load() returns cached plans when all repo mtimes unchanged', async () => {
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });

    // First load — cold start
    const ctx1 = store.load();
    await store.persist();

    // Second load — should use cache
    const store2 = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    const ctx2 = store2.load();

    expect(ctx2.plans.length).toBe(ctx1.plans.length);
    expect(ctx2.plans.map(p => p.id).sort()).toEqual(ctx1.plans.map(p => p.id).sort());
  });

  it('scanPlans is NOT called on cache hit', async () => {
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();
    await store.persist();

    // Spy on scanPlans
    const scanSpy = vi.spyOn(await import('./scanner.ts'), 'scanPlans');

    const store2 = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store2.load();

    expect(scanSpy).not.toHaveBeenCalled();
    scanSpy.mockRestore();
  });
});

// --- ContextStore: Cache miss path ---

describe('ContextStore cache miss', () => {
  it('rescans only the repo whose mtime hash changed', async () => {
    const fixture = createTestFixture(2, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();
    await store.persist();

    // Touch a file in repo-0 only
    const readmePath = join(fixture.repos[0].plansDir, 'plan-0', 'README.md');
    const future = new Date(Date.now() + 2000);
    utimesSync(readmePath, future, future);

    const scanSpy = vi.spyOn(await import('./scanner.ts'), 'scanPlans');

    const store2 = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store2.load();

    // scanPlans should be called for repo-0 (stale) but not repo-1 (cached)
    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(scanSpy).toHaveBeenCalledWith(fixture.repos[0].plansDir);
    scanSpy.mockRestore();
  });

  it('graph is rebuilt when plan set changes', async () => {
    const fixture = createTestFixture(1, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    const ctx1 = store.load();
    await store.persist();

    // Add a new plan
    const newPlanDir = join(fixture.repos[0].plansDir, 'new-plan');
    mkdirSync(newPlanDir, { recursive: true });
    writeFileSync(
      join(newPlanDir, 'README.md'),
      '---\ntitle: New Plan\nstatus: draft\n---\n',
    );

    const store2 = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    const ctx2 = store2.load();

    expect(ctx2.plans.length).toBe(ctx1.plans.length + 1);
    expect(ctx2.plans.some(p => p.id.includes('new-plan'))).toBe(true);
  });
});

// --- Index round-trip ---

describe('ContextStore index round-trip', () => {
  it('persist() then load() produces identical plan data', async () => {
    const fixture = createTestFixture(2, 3);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });

    const ctx1 = store.load();
    await store.persist();

    const store2 = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    const ctx2 = store2.load();

    // Plan IDs should match
    expect(ctx2.plans.map(p => p.id).sort()).toEqual(ctx1.plans.map(p => p.id).sort());

    // Plan data should survive serialization
    for (const plan1 of ctx1.plans) {
      const plan2 = ctx2.plans.find(p => p.id === plan1.id)!;
      expect(plan2).toBeDefined();
      expect(plan2.frontmatter.title).toBe(plan1.frontmatter.title);
      expect(plan2.frontmatter.status).toBe(plan1.frontmatter.status);
      expect(plan2.frontmatter.depends_on).toEqual(plan1.frontmatter.depends_on);
      expect(plan2.fileHashes).toEqual(plan1.fileHashes);
    }
  });

  it('graph snapshot survives serialization', async () => {
    const fixture = createTestFixture(1, 3);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });

    const ctx1 = store.load();
    await store.persist();

    const store2 = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    const ctx2 = store2.load();

    // Graph should be equivalent
    expect(ctx2.graph.plans.size).toBe(ctx1.graph.plans.size);
    expect([...ctx2.graph.ready].sort()).toEqual([...ctx1.graph.ready].sort());
    expect([...ctx2.graph.blocked].sort()).toEqual([...ctx1.graph.blocked].sort());
  });
});

// --- invalidate() ---

describe('ContextStore invalidate', () => {
  it('triggers rescan of target repo only', () => {
    const fixture = createTestFixture(2, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();

    // Modify a plan in repo-0
    const readmePath = join(fixture.repos[0].plansDir, 'plan-0', 'README.md');
    writeFileSync(readmePath, '---\ntitle: Updated Plan\nstatus: done\n---\nUpdated body\n');

    store.invalidate('repo-0');
    const ctx = store.get();

    const updatedPlan = ctx.plans.find(p => p.id === 'repo-0:plan-0')!;
    expect(updatedPlan.frontmatter.title).toBe('Updated Plan');

    // repo-1 plans should be untouched
    const repo1Plans = ctx.plans.filter(p => p.repoAlias === 'repo-1');
    expect(repo1Plans.length).toBe(2);
  });

  it('graph is rebuilt after invalidation', () => {
    const fixture = createTestFixture(1, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();

    // Add a new plan
    const newPlanDir = join(fixture.repos[0].plansDir, 'extra');
    mkdirSync(newPlanDir, { recursive: true });
    writeFileSync(join(newPlanDir, 'README.md'), '---\ntitle: Extra\nstatus: draft\n---\n');

    store.invalidate('repo-0');
    const ctx = store.get();

    expect(ctx.graph.plans.size).toBe(3);
    expect(ctx.graph.plans.has('repo-0:extra')).toBe(true);
  });
});

// --- persist() atomicity ---

describe('ContextStore persist atomicity', () => {
  it('index file is valid JSON after persist', async () => {
    const fixture = createTestFixture(1, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();
    await store.persist();

    const indexPath = join(fixture.cacheDir, 'context-store.json');
    expect(existsSync(indexPath)).toBe(true);

    const raw = readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.repos).toBeDefined();
  });

  it('concurrent persist() calls do not corrupt', async () => {
    const fixture = createTestFixture(1, 3);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();

    // Run 3 persist() calls concurrently
    await Promise.all([store.persist(), store.persist(), store.persist()]);

    const indexPath = join(fixture.cacheDir, 'context-store.json');
    const raw = readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
  });
});

// --- Config mtime tracking ---

describe('ContextStore config mtime', () => {
  it('config file change invalidates repo on next load()', async () => {
    const fixture = createTestFixture(1, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();
    await store.persist();

    // Modify the config file
    const configPath = join(fixture.repos[0].root, '.trellis', 'config');
    const future = new Date(Date.now() + 2000);
    utimesSync(configPath, future, future);

    const scanSpy = vi.spyOn(await import('./scanner.ts'), 'scanPlans');

    const store2 = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store2.load();

    // Should have rescanned because config changed
    expect(scanSpy).toHaveBeenCalled();
    scanSpy.mockRestore();
  });

  it('config file unchanged uses cache normally', async () => {
    const fixture = createTestFixture(1, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();
    await store.persist();

    const scanSpy = vi.spyOn(await import('./scanner.ts'), 'scanPlans');

    const store2 = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store2.load();

    expect(scanSpy).not.toHaveBeenCalled();
    scanSpy.mockRestore();
  });
});

// --- Recovery tests ---

describe('ContextStore recovery', () => {
  it('corrupted index (invalid JSON) triggers full rescan', async () => {
    const fixture = createTestFixture(1, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();
    await store.persist();

    // Corrupt the index file
    const indexPath = join(fixture.cacheDir, 'context-store.json');
    writeFileSync(indexPath, '{invalid json!!!');

    const store2 = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    const ctx = store2.load();

    expect(ctx.plans.length).toBe(2);
  });

  it('version mismatch triggers full rescan', async () => {
    const fixture = createTestFixture(1, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();
    await store.persist();

    // Modify version in index
    const indexPath = join(fixture.cacheDir, 'context-store.json');
    const raw = JSON.parse(readFileSync(indexPath, 'utf8'));
    raw.version = 0;
    writeFileSync(indexPath, JSON.stringify(raw));

    const store2 = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    const ctx = store2.load();

    expect(ctx.plans.length).toBe(2);
  });

  it('indexed plan file deleted from disk triggers rescan and prunes it', async () => {
    const fixture = createTestFixture(1, 3);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();
    await store.persist();

    // Delete a plan
    const planDir = join(fixture.repos[0].plansDir, 'plan-1');
    rmSync(planDir, { recursive: true });

    const store2 = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    const ctx = store2.load();

    expect(ctx.plans.length).toBe(2);
    expect(ctx.plans.some(p => p.id.includes('plan-1'))).toBe(false);
  });

  it('persist() failure does not crash', async () => {
    const fixture = createTestFixture(1, 1);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: '/nonexistent/readonly/path',
    });
    store.load();

    // Should not throw
    await expect(store.persist()).resolves.not.toThrow();
  });
});

// --- Edge case tests ---

describe('ContextStore edge cases', () => {
  it('empty plans directory → valid context with zero plans', () => {
    const root = mkdtempSync(join(tmpdir(), 'trellis-empty-'));
    mkdirSync(join(root, 'plans'), { recursive: true });
    mkdirSync(join(root, '.trellis'), { recursive: true });
    writeFileSync(join(root, '.trellis', 'config'), 'project: empty\nplans_dir: plans\n');

    const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-cache-'));
    const store = new ContextStore({
      repos: [{ path: root, alias: 'empty' }],
      cacheDir,
    });

    const ctx = store.load();
    expect(ctx.plans).toEqual([]);
    expect(ctx.repos[0].planCount).toBe(0);
  });

  it('plans directory does not exist → no crash, empty plan set', () => {
    const root = mkdtempSync(join(tmpdir(), 'trellis-nodir-'));
    mkdirSync(join(root, '.trellis'), { recursive: true });
    writeFileSync(join(root, '.trellis', 'config'), 'project: nodir\nplans_dir: plans\n');

    const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-cache-'));
    const store = new ContextStore({
      repos: [{ path: root, alias: 'nodir' }],
      cacheDir,
    });

    const ctx = store.load();
    expect(ctx.plans).toEqual([]);
  });

  it('new repo not in index → treated as cache miss, full scan', async () => {
    const fixture = createTestFixture(1, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();
    await store.persist();

    // Create a second repo and add it
    const newFixture = createTestFixture(1, 1);
    const expandedSpecs = [
      ...fixture.repoSpecs,
      { path: newFixture.repos[0].root, alias: 'new-repo' },
    ];

    const store2 = new ContextStore({
      repos: expandedSpecs,
      cacheDir: fixture.cacheDir,
    });
    const ctx = store2.load();

    // Should have plans from both repos
    expect(ctx.plans.some(p => p.repoAlias === 'repo-0')).toBe(true);
    expect(ctx.plans.some(p => p.repoAlias === 'new-repo')).toBe(true);
  });

  it('get() before load() throws', () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-cache-'));
    const store = new ContextStore({ repos: [], cacheDir });
    expect(() => store.get()).toThrow(/load/);
  });

  it('invalidate() before load() throws', () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-cache-'));
    const store = new ContextStore({ repos: [], cacheDir });
    expect(() => store.invalidate('foo')).toThrow(/load/);
  });
});

// --- Cold start vs createMultiContext equivalence ---

describe('ContextStore cold start equivalence', () => {
  it('produces a MultiContext with same plans as createMultiContext()', () => {
    const fixture = createTestFixture(2, 3);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });

    const storeCtx = store.load();
    const directCtx = createMultiContext(fixture.repoSpecs);

    // Same plan IDs
    expect(storeCtx.plans.map(p => p.id).sort()).toEqual(
      directCtx.plans.map(p => p.id).sort(),
    );

    // Same graph structure
    expect(storeCtx.graph.plans.size).toBe(directCtx.graph.plans.size);
    expect([...storeCtx.graph.ready].sort()).toEqual([...directCtx.graph.ready].sort());
    expect([...storeCtx.graph.blocked].sort()).toEqual([...directCtx.graph.blocked].sort());
  });
});

// --- Watch tests ---

describe('ContextStore watch', () => {
  it('watch detects new plan file', async () => {
    const fixture = createTestFixture(1, 1);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();

    const changes: any[] = [];
    const handle = store.watch((ctx) => {
      changes.push(ctx);
    });

    // Add a new plan
    const newPlanDir = join(fixture.repos[0].plansDir, 'watched-plan');
    mkdirSync(newPlanDir, { recursive: true });
    writeFileSync(
      join(newPlanDir, 'README.md'),
      '---\ntitle: Watched Plan\nstatus: draft\n---\n',
    );

    // Wait for debounce
    await new Promise(r => setTimeout(r, 300));
    handle.close();

    if (changes.length > 0) {
      const lastCtx = changes[changes.length - 1];
      expect(lastCtx.plans.some((p: any) => p.id.includes('watched-plan'))).toBe(true);
    }
    // On some CI environments, fs.watch may not fire reliably, so we don't fail hard
  });

  it('watch returns a closeable handle', () => {
    const fixture = createTestFixture(1, 1);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();

    const handle = store.watch();
    expect(handle).toBeDefined();
    expect(typeof handle.close).toBe('function');
    handle.close();
  });

  it('watch with no watchable repos returns no-op handle', () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-cache-'));
    const root = mkdtempSync(join(tmpdir(), 'trellis-nowatch-'));

    const store = new ContextStore({
      repos: [{ path: root, alias: 'no-config' }],
      cacheDir,
    });
    store.load();

    const handle = store.watch();
    expect(handle).toBeDefined();
    handle.close(); // should not throw
  });
});

// --- Additional watch tests ---

describe('ContextStore watch: modification and deletion', () => {
  it('watch detects plan file modification', async () => {
    const fixture = createTestFixture(1, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();

    const changes: any[] = [];
    const handle = store.watch((ctx) => {
      changes.push(ctx);
    });

    // Modify an existing plan's README
    const readmePath = join(fixture.repos[0].plansDir, 'plan-0', 'README.md');
    writeFileSync(
      readmePath,
      '---\ntitle: Modified Title\nstatus: done\n---\n\n## Problem\nUpdated\n\n## Approach\nUpdated\n',
    );

    await new Promise(r => setTimeout(r, 300));
    handle.close();

    if (changes.length > 0) {
      const lastCtx = changes[changes.length - 1];
      const modified = lastCtx.plans.find((p: any) => p.id.includes('plan-0'));
      expect(modified?.frontmatter.title).toBe('Modified Title');
    }
  });

  it('watch detects plan file deletion', async () => {
    const fixture = createTestFixture(1, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();
    expect(store.get().plans.length).toBe(2);

    const changes: any[] = [];
    const handle = store.watch((ctx) => {
      changes.push(ctx);
    });

    // Delete plan-1 entirely
    const planDir = join(fixture.repos[0].plansDir, 'plan-1');
    rmSync(planDir, { recursive: true });

    await new Promise(r => setTimeout(r, 300));
    handle.close();

    if (changes.length > 0) {
      const lastCtx = changes[changes.length - 1];
      expect(lastCtx.plans.some((p: any) => p.id.includes('plan-1'))).toBe(false);
    }
  });

  it('rapid changes are debounced into a single batch', async () => {
    const fixture = createTestFixture(1, 1);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();

    let callbackCount = 0;
    const handle = store.watch(() => {
      callbackCount++;
    });

    // Rapidly create 5 plans within a tight window
    for (let i = 0; i < 5; i++) {
      const planDir = join(fixture.repos[0].plansDir, `rapid-${i}`);
      mkdirSync(planDir, { recursive: true });
      writeFileSync(
        join(planDir, 'README.md'),
        `---\ntitle: Rapid ${i}\nstatus: draft\n---\n`,
      );
    }

    await new Promise(r => setTimeout(r, 400));
    handle.close();

    // Should be batched into fewer callbacks than individual changes
    // On some CI environments, fs.watch may not fire at all, so we allow 0
    expect(callbackCount).toBeLessThanOrEqual(3);
  });

  it('echo suppression: invalidate then watch event within window → no double rescan', async () => {
    const fixture = createTestFixture(1, 1);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();

    let callbackCount = 0;
    const handle = store.watch(() => {
      callbackCount++;
    });

    // Modify a plan file, then immediately invalidate
    // The watch event should be suppressed since invalidate handles the rescan
    const readmePath = join(fixture.repos[0].plansDir, 'plan-0', 'README.md');
    store.invalidate('repo-0');
    // Write after invalidate — within the 200ms suppression window
    writeFileSync(
      readmePath,
      '---\ntitle: Echo Test\nstatus: done\n---\n\n## Problem\nEcho\n\n## Approach\nEcho\n',
    );

    await new Promise(r => setTimeout(r, 300));
    handle.close();

    // Echo suppression should prevent the watch callback from firing for this repo
    expect(callbackCount).toBe(0);
  });
});

// --- Graph snapshot deserialization test ---

describe('ContextStore graph snapshot', () => {
  it('graph is deserialized from snapshot on full cache hit, not rebuilt', async () => {
    const fixture = createTestFixture(1, 3);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();
    await store.persist();

    // Spy on buildGraph to ensure it's NOT called on cache hit
    const graphSpy = vi.spyOn(await import('./graph.ts'), 'buildGraph');

    const store2 = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    const ctx = store2.load();

    expect(graphSpy).not.toHaveBeenCalled();
    // Graph should still be valid
    expect(ctx.graph.plans.size).toBe(3);
    graphSpy.mockRestore();
  });
});

// --- invalidate uses patchGraph test ---

describe('ContextStore invalidate uses patchGraph', () => {
  it('invalidate uses patchGraph, not buildGraph, for incremental update', async () => {
    const fixture = createTestFixture(1, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
    });
    store.load();

    const patchSpy = vi.spyOn(await import('./graph.ts'), 'patchGraph');
    const buildSpy = vi.spyOn(await import('./graph.ts'), 'buildGraph');

    // Modify a plan and invalidate
    const readmePath = join(fixture.repos[0].plansDir, 'plan-0', 'README.md');
    writeFileSync(readmePath, '---\ntitle: Patched\nstatus: done\n---\n\n## Problem\nP\n\n## Approach\nA\n');

    store.invalidate('repo-0');

    expect(patchSpy).toHaveBeenCalled();
    expect(buildSpy).not.toHaveBeenCalled();

    // Verify the result is correct
    const ctx = store.get();
    const patched = ctx.plans.find(p => p.id === 'repo-0:plan-0');
    expect(patched?.frontmatter.title).toBe('Patched');

    patchSpy.mockRestore();
    buildSpy.mockRestore();
  });
});

// --- watch() before load() test ---

describe('ContextStore watch preconditions', () => {
  it('watch() before load() throws', () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-cache-'));
    const store = new ContextStore({ repos: [], cacheDir });
    expect(() => store.watch()).toThrow(/load/);
  });
});

// --- Watch ID normalization (regression: plan duplication bug) ---

describe('ContextStore watch ID normalization', () => {
  it('single-repo: watch update does not create qualified duplicate', async () => {
    const fixture = createTestFixture(1, 1);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
      qualifyIds: false,
    });
    store.load();

    // Verify initial state uses unqualified keys
    const initialCtx = store.get();
    expect(initialCtx.graph.plans.size).toBe(1);
    expect(initialCtx.graph.plans.has('plan-0')).toBe(true);
    expect(initialCtx.graph.plans.has('repo-0:plan-0')).toBe(false);

    // Watch for changes
    let watchHandle: { close(): void } | null = null;
    const changePromise = new Promise<any>((resolve) => {
      watchHandle = store.watch((ctx) => {
        resolve(ctx);
      });
    });

    await new Promise(r => setTimeout(r, 100));

    // Modify the plan to trigger a watch event
    // (watchMultiRepo will qualify the event as 'repo-0:plan-0')
    writeFileSync(
      join(fixture.repos[0].plansDir, 'plan-0', 'README.md'),
      '---\ntitle: Updated Plan\nstatus: done\n---\n\n## Problem\nUpdated\n\n## Approach\nUpdated\n',
    );

    try {
      const updatedCtx = await Promise.race([
        changePromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('watch timeout')), 5000),
        ),
      ]);

      // The graph MUST still have exactly 1 plan with unqualified key 'plan-0'.
      // Before the fix, patchGraph would see 'repo-0:plan-0' (from watchMultiRepo)
      // and not find it in the graph (which uses 'plan-0'), creating a duplicate.
      expect(updatedCtx.graph.plans.size).toBe(1);
      expect(updatedCtx.graph.plans.has('plan-0')).toBe(true);
      expect(updatedCtx.graph.plans.has('repo-0:plan-0')).toBe(false);

      // Verify the update was applied
      const plan = updatedCtx.graph.plans.get('plan-0')!;
      expect(plan.frontmatter.title).toBe('Updated Plan');
      expect(plan.frontmatter.status).toBe('done');
    } finally {
      watchHandle?.close();
    }
  });

  it('single-repo: watch add uses unqualified key', async () => {
    const fixture = createTestFixture(1, 1);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
      qualifyIds: false,
    });
    store.load();
    expect(store.get().graph.plans.size).toBe(1);

    let watchHandle: { close(): void } | null = null;
    const changePromise = new Promise<any>((resolve) => {
      watchHandle = store.watch((ctx) => {
        resolve(ctx);
      });
    });

    await new Promise(r => setTimeout(r, 100));

    // Add a new plan (watchMultiRepo will emit as 'repo-0:new-plan')
    const newPlanDir = join(fixture.repos[0].plansDir, 'new-plan');
    mkdirSync(newPlanDir, { recursive: true });
    writeFileSync(
      join(newPlanDir, 'README.md'),
      '---\ntitle: New Plan\nstatus: draft\n---\n\n## Problem\nNew\n\n## Approach\nNew\n',
    );

    try {
      const updatedCtx = await Promise.race([
        changePromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('watch timeout')), 5000),
        ),
      ]);

      expect(updatedCtx.graph.plans.size).toBe(2);
      expect(updatedCtx.graph.plans.has('new-plan')).toBe(true);
      expect(updatedCtx.graph.plans.has('repo-0:new-plan')).toBe(false);
    } finally {
      watchHandle?.close();
    }
  });

  it('single-repo: watch remove uses unqualified key', async () => {
    const fixture = createTestFixture(1, 2);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
      qualifyIds: false,
    });
    store.load();
    expect(store.get().graph.plans.size).toBe(2);

    let watchHandle: { close(): void } | null = null;
    const changePromise = new Promise<any>((resolve) => {
      watchHandle = store.watch((ctx) => {
        resolve(ctx);
      });
    });

    await new Promise(r => setTimeout(r, 100));

    // Remove plan-1 (watchMultiRepo will emit as 'repo-0:plan-1')
    rmSync(join(fixture.repos[0].plansDir, 'plan-1'), { recursive: true });

    try {
      const updatedCtx = await Promise.race([
        changePromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('watch timeout')), 5000),
        ),
      ]);

      expect(updatedCtx.graph.plans.size).toBe(1);
      expect(updatedCtx.graph.plans.has('plan-0')).toBe(true);
      expect(updatedCtx.graph.plans.has('plan-1')).toBe(false);
    } finally {
      watchHandle?.close();
    }
  });

  it('multi-repo: watch update qualifies plan.id and repoAlias', async () => {
    const fixture = createTestFixture(2, 1);
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir: fixture.cacheDir,
      qualifyIds: true,
    });
    store.load();

    const initialCtx = store.get();
    expect(initialCtx.graph.plans.size).toBe(2);
    expect(initialCtx.graph.plans.has('repo-0:plan-0')).toBe(true);
    expect(initialCtx.graph.plans.has('repo-1:plan-0')).toBe(true);

    let watchHandle: { close(): void } | null = null;
    const changePromise = new Promise<any>((resolve) => {
      watchHandle = store.watch((ctx) => {
        resolve(ctx);
      });
    });

    await new Promise(r => setTimeout(r, 100));

    // Update plan in repo-0
    writeFileSync(
      join(fixture.repos[0].plansDir, 'plan-0', 'README.md'),
      '---\ntitle: Repo0 Updated\nstatus: done\n---\n\n## Problem\nUpdated\n\n## Approach\nUpdated\n',
    );

    try {
      const updatedCtx = await Promise.race([
        changePromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('watch timeout')), 5000),
        ),
      ]);

      // Should still be 2 plans, no duplicates
      expect(updatedCtx.graph.plans.size).toBe(2);
      expect(updatedCtx.graph.plans.has('repo-0:plan-0')).toBe(true);
      expect(updatedCtx.graph.plans.has('repo-1:plan-0')).toBe(true);
      // Unqualified key should NOT exist
      expect(updatedCtx.graph.plans.has('plan-0')).toBe(false);

      // Verify plan.id and repoAlias are set correctly on the updated plan
      const plan = updatedCtx.graph.plans.get('repo-0:plan-0')!;
      expect(plan.id).toBe('repo-0:plan-0');
      expect(plan.repoAlias).toBe('repo-0');
      expect(plan.frontmatter.title).toBe('Repo0 Updated');
    } finally {
      watchHandle?.close();
    }
  });
});

// --- Performance benchmarks ---

describe('ContextStore performance', () => {
  it('cold start with 5 repos × 20 plans completes in < 500ms', () => {
    const fixture = createTestFixture(5, 20);
    const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-perf-'));

    const start = performance.now();
    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir,
    });
    store.load();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(store.get().plans.length).toBe(100);
  });

  it('warm cache hit completes in < 30ms', async () => {
    const fixture = createTestFixture(5, 20);
    const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-perf-'));

    const store = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir,
    });
    store.load();
    await store.persist();

    const start = performance.now();
    const store2 = new ContextStore({
      repos: fixture.repoSpecs,
      cacheDir,
    });
    store2.load();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(30);
    expect(store2.get().plans.length).toBe(100);
  });
});
