import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EventEmitter } from 'events';
import { createContext, refreshContext } from '../../core/index.ts';
import type { TrellisContext } from '../../core/index.ts';
import { watchPlans, unwatchPlans, isWatching, type WatchState } from './logic.ts';

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
  const planDir = join(plansDir, id);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, 'README.md'), `---\n${fm}\n---\n\nBody for ${id}\n`);
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

describe('watch functionality', () => {
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
