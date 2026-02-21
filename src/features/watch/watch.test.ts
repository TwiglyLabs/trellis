import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EventEmitter } from 'events';
import { createContext, refreshContext } from '../../core/index.ts';
import type { TrellisContext } from '../../core/index.ts';
import {
  watchPlans, unwatchPlans, isWatching,
  resolvePath, computeHash, buildHashMap,
  watchMultiRepo,
  type WatchState,
} from './logic.ts';
import type { PlanChangeBatch, PlanChangeEvent, WatchHandle } from './types.ts';

// --- Helpers ---

function createTestProject() {
  const tmpDir = join(tmpdir(), `trellis-watch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const plansDir = join(tmpDir, 'plans');
  mkdirSync(plansDir, { recursive: true });
  mkdirSync(join(tmpDir, '.trellis'), { recursive: true });
  writeFileSync(join(tmpDir, '.trellis', 'config'), 'project: test-project\nplans_dir: plans\n');
  return { tmpDir, plansDir };
}

function writePlan(plansDir: string, id: string, frontmatter: Record<string, unknown>) {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - ${i}`).join('\n')}`;
      return `${k}: ${v}`;
    })
    .join('\n');
  const planDir = join(plansDir, id);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, 'README.md'), `---\n${fm}\n---\n\nBody for ${id}\n`);
}

function writePlanFile(plansDir: string, planId: string, fileName: string, content: string) {
  const planDir = join(plansDir, planId);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, fileName), content);
}

class WatchableContext extends EventEmitter {
  private ctx: TrellisContext;
  private state: WatchState = { watcher: null, debounceTimer: null };

  constructor(projectDir: string) {
    super();
    this.ctx = createContext(projectDir);
  }

  get projectDir() { return this.ctx.projectDir; }
  get config() { return this.ctx.config; }

  refresh() {
    this.ctx = refreshContext(this.ctx);
  }

  graph() {
    return this.ctx.graph;
  }

  watch() {
    watchPlans(this, this.state);
  }

  unwatch() {
    unwatchPlans(this.state);
  }

  get isWatching() {
    return isWatching(this.state);
  }
}

// --- Unit tests for resolvePath ---

describe('resolvePath', () => {
  it('resolves README.md to readme kind', () => {
    const result = resolvePath('/plans', 'my-plan/README.md');
    expect(result).toEqual({
      planId: 'my-plan',
      fileKind: 'readme',
      absolutePath: '/plans/my-plan/README.md',
    });
  });

  it('resolves implementation.md to implementation kind', () => {
    const result = resolvePath('/plans', 'my-plan/implementation.md');
    expect(result).toEqual({
      planId: 'my-plan',
      fileKind: 'implementation',
      absolutePath: '/plans/my-plan/implementation.md',
    });
  });

  it('resolves inputs.md to inputs kind', () => {
    const result = resolvePath('/plans', 'my-plan/inputs.md');
    expect(result).toEqual({
      planId: 'my-plan',
      fileKind: 'inputs',
      absolutePath: '/plans/my-plan/inputs.md',
    });
  });

  it('resolves outputs.md to outputs kind', () => {
    const result = resolvePath('/plans', 'my-plan/outputs.md');
    expect(result).toEqual({
      planId: 'my-plan',
      fileKind: 'outputs',
      absolutePath: '/plans/my-plan/outputs.md',
    });
  });

  it('resolves nested plan directories', () => {
    const result = resolvePath('/plans', 'category/sub-plan/README.md');
    expect(result).toEqual({
      planId: 'category/sub-plan',
      fileKind: 'readme',
      absolutePath: '/plans/category/sub-plan/README.md',
    });
  });

  it('returns null for unrecognized filenames', () => {
    expect(resolvePath('/plans', 'my-plan/notes.txt')).toBeNull();
    expect(resolvePath('/plans', 'my-plan/CHANGELOG.md')).toBeNull();
  });

  it('returns null for paths without a plan directory', () => {
    expect(resolvePath('/plans', 'README.md')).toBeNull();
  });
});

// --- Unit tests for computeHash ---

describe('computeHash', () => {
  it('returns 16-char hex string', () => {
    const hash = computeHash('hello world');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces same hash for same content', () => {
    expect(computeHash('test content')).toBe(computeHash('test content'));
  });

  it('produces different hash for different content', () => {
    expect(computeHash('content A')).not.toBe(computeHash('content B'));
  });
});

// --- Unit tests for buildHashMap ---

describe('buildHashMap', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('hashes all plan files', () => {
    writePlan(plansDir, 'plan-a', { title: 'Plan A', status: 'not_started' });
    writePlanFile(plansDir, 'plan-a', 'implementation.md', '## Steps\n\nDo things');

    const hashMap = buildHashMap(plansDir);
    expect(hashMap.size).toBe(2); // README.md + implementation.md
    expect(hashMap.has(join(plansDir, 'plan-a', 'README.md'))).toBe(true);
    expect(hashMap.has(join(plansDir, 'plan-a', 'implementation.md'))).toBe(true);
  });

  it('returns empty map for empty plans dir', () => {
    const hashMap = buildHashMap(plansDir);
    expect(hashMap.size).toBe(0);
  });
});

// --- Legacy interface tests ---

describe('watch legacy interface', () => {
  let tmpDir: string;
  let plansDir: string;
  let watchable: WatchableContext;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
    writePlan(plansDir, 'initial', { title: 'Initial', status: 'not_started' });
    watchable = new WatchableContext(tmpDir);
  });

  afterEach(() => {
    watchable.unwatch();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits change event when a plan file is modified', async () => {
    const changePromise = new Promise<any>((resolve) => {
      watchable.on('change', resolve);
    });

    watchable.watch();

    // Let watcher initialize
    await new Promise(r => setTimeout(r, 50));
    writePlan(plansDir, 'new-plan', { title: 'New Plan', status: 'not_started' });

    const result = await Promise.race([
      changePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    expect(result.plans.size).toBeGreaterThanOrEqual(2);
  });

  it('unwatch stops watching', async () => {
    let changeCount = 0;
    watchable.on('change', () => changeCount++);

    watchable.watch();
    await new Promise(r => setTimeout(r, 50));

    watchable.unwatch();

    writePlan(plansDir, 'after-unwatch', { title: 'After', status: 'not_started' });
    await new Promise(r => setTimeout(r, 300));

    expect(changeCount).toBe(0);
  });

  it('isWatching reflects state', () => {
    expect(watchable.isWatching).toBe(false);
    watchable.watch();
    expect(watchable.isWatching).toBe(true);
    watchable.unwatch();
    expect(watchable.isWatching).toBe(false);
  });

  it('watch is idempotent (calling twice does not duplicate)', async () => {
    let changeCount = 0;
    watchable.on('change', () => changeCount++);

    watchable.watch();
    watchable.watch(); // second call should be a no-op

    await new Promise(r => setTimeout(r, 50));
    writePlan(plansDir, 'second', { title: 'Second', status: 'not_started' });

    await Promise.race([
      new Promise<void>(resolve => {
        watchable.on('change', () => { if (changeCount >= 1) resolve(); });
      }),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    // Wait a bit to ensure no duplicate fires
    await new Promise(r => setTimeout(r, 200));
    expect(changeCount).toBe(1);
  });

  it('can restart watching after unwatch', async () => {
    watchable.watch();
    watchable.unwatch();

    const changePromise = new Promise<any>(resolve => {
      watchable.on('change', resolve);
    });

    watchable.watch();
    await new Promise(r => setTimeout(r, 50));
    writePlan(plansDir, 'restart', { title: 'Restart', status: 'not_started' });

    const result = await Promise.race([
      changePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    expect(result.plans.size).toBeGreaterThanOrEqual(2);
  });
});

// --- New typed watch interface tests ---

describe('watchPlans (typed events)', () => {
  let tmpDir: string;
  let plansDir: string;
  let handle: WatchHandle | null;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
    handle = null;
  });

  afterEach(() => {
    handle?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits plan-added when a new plan directory is created', async () => {
    writePlan(plansDir, 'existing', { title: 'Existing', status: 'not_started' });

    const batchPromise = new Promise<PlanChangeBatch>((resolve) => {
      handle = watchPlans(plansDir, resolve, { debounceMs: 50 });
    });

    await new Promise(r => setTimeout(r, 50));
    writePlan(plansDir, 'new-plan', { title: 'New Plan', status: 'draft' });

    const batch = await Promise.race([
      batchPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    expect(batch.events.length).toBeGreaterThanOrEqual(1);
    const addedEvent = batch.events.find(e => e.type === 'plan-added' && e.planId === 'new-plan');
    expect(addedEvent).toBeDefined();
    expect(addedEvent!.type).toBe('plan-added');
    if (addedEvent!.type === 'plan-added') {
      expect(addedEvent!.plan.frontmatter.title).toBe('New Plan');
    }
  });

  it('emits plan-updated when an existing plan file is modified', async () => {
    writePlan(plansDir, 'my-plan', { title: 'My Plan', status: 'not_started' });

    const batchPromise = new Promise<PlanChangeBatch>((resolve) => {
      handle = watchPlans(plansDir, resolve, { debounceMs: 50 });
    });

    await new Promise(r => setTimeout(r, 50));
    // Modify the existing README.md with different content
    writeFileSync(
      join(plansDir, 'my-plan', 'README.md'),
      '---\ntitle: My Plan Updated\nstatus: not_started\n---\n\nUpdated body\n',
    );

    const batch = await Promise.race([
      batchPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    const updatedEvent = batch.events.find(e => e.type === 'plan-updated' && e.planId === 'my-plan');
    expect(updatedEvent).toBeDefined();
    if (updatedEvent?.type === 'plan-updated') {
      expect(updatedEvent.file).toBe('readme');
      expect(updatedEvent.plan.frontmatter.title).toBe('My Plan Updated');
    }
  });

  it('emits plan-updated for implementation.md changes', async () => {
    writePlan(plansDir, 'my-plan', { title: 'My Plan', status: 'not_started' });

    const batchPromise = new Promise<PlanChangeBatch>((resolve) => {
      handle = watchPlans(plansDir, resolve, { debounceMs: 50 });
    });

    await new Promise(r => setTimeout(r, 50));
    writePlanFile(plansDir, 'my-plan', 'implementation.md', '## Steps\n\nNew implementation');

    const batch = await Promise.race([
      batchPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    const updatedEvent = batch.events.find(
      e => e.type === 'plan-updated' && e.planId === 'my-plan',
    );
    expect(updatedEvent).toBeDefined();
    if (updatedEvent?.type === 'plan-updated') {
      expect(updatedEvent.file).toBe('implementation');
    }
  });

  it('emits plan-removed when a plan directory is deleted', async () => {
    writePlan(plansDir, 'doomed', { title: 'Doomed', status: 'draft' });

    const batchPromise = new Promise<PlanChangeBatch>((resolve) => {
      handle = watchPlans(plansDir, resolve, { debounceMs: 50 });
    });

    await new Promise(r => setTimeout(r, 50));
    rmSync(join(plansDir, 'doomed'), { recursive: true, force: true });

    const batch = await Promise.race([
      batchPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    const removedEvent = batch.events.find(e => e.type === 'plan-removed' && e.planId === 'doomed');
    expect(removedEvent).toBeDefined();
  });

  it('suppresses phantom rebuilds (same content written twice)', async () => {
    writePlan(plansDir, 'stable', { title: 'Stable', status: 'not_started' });

    const batches: PlanChangeBatch[] = [];
    handle = watchPlans(plansDir, (batch) => batches.push(batch), { debounceMs: 50 });

    await new Promise(r => setTimeout(r, 50));

    // Write exact same content
    const readmePath = join(plansDir, 'stable', 'README.md');
    const { readFileSync } = await import('fs');
    const originalContent = readFileSync(readmePath, 'utf8');
    writeFileSync(readmePath, originalContent);

    // Wait for potential debounce
    await new Promise(r => setTimeout(r, 300));

    // Should have no events since content hash didn't change
    expect(batches.length).toBe(0);
  });

  it('batches rapid writes into a single callback', async () => {
    writePlan(plansDir, 'plan-a', { title: 'Plan A', status: 'not_started' });
    writePlan(plansDir, 'plan-b', { title: 'Plan B', status: 'not_started' });
    writePlan(plansDir, 'plan-c', { title: 'Plan C', status: 'not_started' });

    const batches: PlanChangeBatch[] = [];
    handle = watchPlans(plansDir, (batch) => batches.push(batch), { debounceMs: 200 });

    await new Promise(r => setTimeout(r, 50));

    // Rapid writes within the debounce window
    writeFileSync(
      join(plansDir, 'plan-a', 'README.md'),
      '---\ntitle: Plan A v2\nstatus: not_started\n---\n\nUpdated A\n',
    );
    writeFileSync(
      join(plansDir, 'plan-b', 'README.md'),
      '---\ntitle: Plan B v2\nstatus: not_started\n---\n\nUpdated B\n',
    );
    writeFileSync(
      join(plansDir, 'plan-c', 'README.md'),
      '---\ntitle: Plan C v2\nstatus: not_started\n---\n\nUpdated C\n',
    );

    // Wait for debounce to fire
    await new Promise(r => setTimeout(r, 500));

    // Should be a single batch with 3 events
    expect(batches.length).toBe(1);
    expect(batches[0].events.length).toBe(3);
    expect(batches[0].timestamp).toBeInstanceOf(Date);
  });

  it('WatchHandle.close() stops emitting events', async () => {
    writePlan(plansDir, 'plan-x', { title: 'Plan X', status: 'not_started' });

    const batches: PlanChangeBatch[] = [];
    handle = watchPlans(plansDir, (batch) => batches.push(batch), { debounceMs: 50 });

    await new Promise(r => setTimeout(r, 50));
    handle.close();
    handle = null; // prevent double-close in afterEach

    writePlan(plansDir, 'after-close', { title: 'After Close', status: 'draft' });
    await new Promise(r => setTimeout(r, 300));

    expect(batches.length).toBe(0);
  });

  it('emits plan-updated for inputs.md changes', async () => {
    writePlan(plansDir, 'my-plan', { title: 'My Plan', status: 'not_started' });

    const batchPromise = new Promise<PlanChangeBatch>((resolve) => {
      handle = watchPlans(plansDir, resolve, { debounceMs: 50 });
    });

    await new Promise(r => setTimeout(r, 50));
    writePlanFile(plansDir, 'my-plan', 'inputs.md', '## Inputs\n\nSome inputs');

    const batch = await Promise.race([
      batchPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    const updatedEvent = batch.events.find(
      e => e.type === 'plan-updated' && e.planId === 'my-plan',
    );
    expect(updatedEvent).toBeDefined();
    if (updatedEvent?.type === 'plan-updated') {
      expect(updatedEvent.file).toBe('inputs');
    }
  });

  it('emits plan-updated for outputs.md changes', async () => {
    writePlan(plansDir, 'my-plan', { title: 'My Plan', status: 'not_started' });

    const batchPromise = new Promise<PlanChangeBatch>((resolve) => {
      handle = watchPlans(plansDir, resolve, { debounceMs: 50 });
    });

    await new Promise(r => setTimeout(r, 50));
    writePlanFile(plansDir, 'my-plan', 'outputs.md', '## Outputs\n\nSome outputs');

    const batch = await Promise.race([
      batchPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    const updatedEvent = batch.events.find(
      e => e.type === 'plan-updated' && e.planId === 'my-plan',
    );
    expect(updatedEvent).toBeDefined();
    if (updatedEvent?.type === 'plan-updated') {
      expect(updatedEvent.file).toBe('outputs');
    }
  });

  it('emits plan-updated when a secondary file is deleted', async () => {
    writePlan(plansDir, 'my-plan', { title: 'My Plan', status: 'not_started' });
    writePlanFile(plansDir, 'my-plan', 'implementation.md', '## Steps\n\nOriginal');

    const batchPromise = new Promise<PlanChangeBatch>((resolve) => {
      handle = watchPlans(plansDir, resolve, { debounceMs: 50 });
    });

    await new Promise(r => setTimeout(r, 50));
    rmSync(join(plansDir, 'my-plan', 'implementation.md'));

    const batch = await Promise.race([
      batchPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    const updatedEvent = batch.events.find(
      e => e.type === 'plan-updated' && e.planId === 'my-plan',
    );
    expect(updatedEvent).toBeDefined();
    if (updatedEvent?.type === 'plan-updated') {
      expect(updatedEvent.file).toBe('implementation');
    }
  });

  it('batches file change and directory deletion within debounce window', async () => {
    writePlan(plansDir, 'plan-a', { title: 'Plan A', status: 'not_started' });
    writePlan(plansDir, 'plan-b', { title: 'Plan B', status: 'not_started' });

    const batchPromise = new Promise<PlanChangeBatch>((resolve) => {
      handle = watchPlans(plansDir, resolve, { debounceMs: 200 });
    });

    await new Promise(r => setTimeout(r, 50));

    // Modify plan-a then delete plan-b within the debounce window
    writeFileSync(
      join(plansDir, 'plan-a', 'README.md'),
      '---\ntitle: Plan A v2\nstatus: not_started\n---\n\nUpdated A\n',
    );
    rmSync(join(plansDir, 'plan-b'), { recursive: true, force: true });

    const batch = await Promise.race([
      batchPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    const updatedEvent = batch.events.find(e => e.type === 'plan-updated' && e.planId === 'plan-a');
    const removedEvent = batch.events.find(e => e.type === 'plan-removed' && e.planId === 'plan-b');
    expect(updatedEvent).toBeDefined();
    expect(removedEvent).toBeDefined();
  });

  it('ignores directories without README.md', async () => {
    writePlan(plansDir, 'valid', { title: 'Valid', status: 'not_started' });

    const batches: PlanChangeBatch[] = [];
    handle = watchPlans(plansDir, (batch) => batches.push(batch), { debounceMs: 50 });

    await new Promise(r => setTimeout(r, 50));

    // Create a directory without README.md — just a random file
    const noReadmeDir = join(plansDir, 'not-a-plan');
    mkdirSync(noReadmeDir, { recursive: true });
    writeFileSync(join(noReadmeDir, 'notes.txt'), 'just a file');

    await new Promise(r => setTimeout(r, 300));

    // No events should fire for unrecognized files
    expect(batches.length).toBe(0);
  });
});

// --- watchMultiRepo tests ---

describe('watchMultiRepo', () => {
  let tmpDirA: string;
  let tmpDirB: string;
  let plansDirA: string;
  let plansDirB: string;
  let handle: WatchHandle | null;

  beforeEach(() => {
    const projectA = createTestProject();
    const projectB = createTestProject();
    tmpDirA = projectA.tmpDir;
    tmpDirB = projectB.tmpDir;
    plansDirA = projectA.plansDir;
    plansDirB = projectB.plansDir;
    handle = null;
  });

  afterEach(() => {
    handle?.close();
    rmSync(tmpDirA, { recursive: true, force: true });
    rmSync(tmpDirB, { recursive: true, force: true });
  });

  it('qualifies planId with repo alias', async () => {
    writePlan(plansDirA, 'plan-one', { title: 'Plan One', status: 'not_started' });

    const batchPromise = new Promise<PlanChangeBatch>((resolve) => {
      handle = watchMultiRepo(
        [
          { alias: 'repo-a', plansDir: plansDirA },
          { alias: 'repo-b', plansDir: plansDirB },
        ],
        resolve,
        { debounceMs: 150 },
      );
    });

    await new Promise(r => setTimeout(r, 100));
    writeFileSync(
      join(plansDirA, 'plan-one', 'README.md'),
      '---\ntitle: Plan One Updated\nstatus: not_started\n---\n\nUpdated\n',
    );

    const batch = await Promise.race([
      batchPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    const event = batch.events.find(e => e.planId.startsWith('repo-a:'));
    expect(event).toBeDefined();
    expect(event!.planId).toBe('repo-a:plan-one');
  });

  it('events from repo B do not leak to repo A namespace', async () => {
    writePlan(plansDirB, 'plan-b', { title: 'Plan B', status: 'not_started' });

    const batchPromise = new Promise<PlanChangeBatch>((resolve) => {
      handle = watchMultiRepo(
        [
          { alias: 'repo-a', plansDir: plansDirA },
          { alias: 'repo-b', plansDir: plansDirB },
        ],
        resolve,
        { debounceMs: 150 },
      );
    });

    await new Promise(r => setTimeout(r, 100));
    writeFileSync(
      join(plansDirB, 'plan-b', 'README.md'),
      '---\ntitle: Plan B Updated\nstatus: not_started\n---\n\nUpdated B\n',
    );

    const batch = await Promise.race([
      batchPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    // All events should be qualified with repo-b
    for (const event of batch.events) {
      expect(event.planId).toMatch(/^repo-b:/);
    }
  });

  it('emits qualified plan-added when new plan is created in second repo', async () => {
    writePlan(plansDirA, 'plan-a', { title: 'Plan A', status: 'not_started' });

    const batchPromise = new Promise<PlanChangeBatch>((resolve) => {
      handle = watchMultiRepo(
        [
          { alias: 'repo-a', plansDir: plansDirA },
          { alias: 'repo-b', plansDir: plansDirB },
        ],
        resolve,
        { debounceMs: 150 },
      );
    });

    await new Promise(r => setTimeout(r, 100));
    writePlan(plansDirB, 'new-plan', { title: 'New Plan B', status: 'draft' });

    const batch = await Promise.race([
      batchPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    const addedEvent = batch.events.find(
      e => e.type === 'plan-added' && e.planId === 'repo-b:new-plan',
    );
    expect(addedEvent).toBeDefined();
    if (addedEvent?.type === 'plan-added') {
      expect(addedEvent.plan.frontmatter.title).toBe('New Plan B');
    }
  });

  it('close() stops all sub-watchers', async () => {
    writePlan(plansDirA, 'plan-a', { title: 'Plan A', status: 'not_started' });
    writePlan(plansDirB, 'plan-b', { title: 'Plan B', status: 'not_started' });

    const batches: PlanChangeBatch[] = [];
    handle = watchMultiRepo(
      [
        { alias: 'repo-a', plansDir: plansDirA },
        { alias: 'repo-b', plansDir: plansDirB },
      ],
      (batch) => batches.push(batch),
      { debounceMs: 50 },
    );

    await new Promise(r => setTimeout(r, 100));
    handle.close();
    handle = null;

    writeFileSync(
      join(plansDirA, 'plan-a', 'README.md'),
      '---\ntitle: After Close\nstatus: not_started\n---\n\nShould not trigger\n',
    );
    await new Promise(r => setTimeout(r, 300));

    expect(batches.length).toBe(0);
  });
});
