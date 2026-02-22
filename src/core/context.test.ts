import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createContext, refreshContext, createContextAsync, refreshContextAsync, createMultiContext, createMultiContextAsync } from './context.ts';
import { createFixture } from '../__tests__/helpers.ts';
import { createTestFixture } from '../__tests__/fixtures/context-store.ts';

describe('createContext', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('builds a full context from project directory', () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    root = fixture.root;

    const ctx = createContext(root);

    expect(ctx.projectDir).toBe(root);
    expect(ctx.config.project).toBe('test-project');
    expect(ctx.plansDir).toBe(join(root, 'plans'));
    expect(ctx.plans).toHaveLength(2);
    expect(ctx.graph.plans.size).toBe(2);
    expect(ctx.graph.ready.has('b')).toBe(true);
  });

  it('detects blocked plans', () => {
    const fixture = createFixture([
      { id: 'dep', title: 'Dep', status: 'not_started' },
      { id: 'child', title: 'Child', status: 'not_started', depends_on: ['dep'] },
    ]);
    root = fixture.root;

    const ctx = createContext(root);

    expect(ctx.graph.blocked.has('child')).toBe(true);
    expect(ctx.graph.ready.has('dep')).toBe(true);
  });

  it('returns default config when .trellis is missing', () => {
    const { mkdtempSync } = require('fs');
    const { tmpdir } = require('os');
    root = mkdtempSync(join(tmpdir(), 'trellis-ctx-'));
    mkdirSync(join(root, 'plans'), { recursive: true });

    const ctx = createContext(root);
    expect(ctx.config.plans_dir).toBe('plans');
    expect(ctx.plans).toHaveLength(0);
  });
});

describe('refreshContext', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('picks up new plans added after initial scan', () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
    ]);
    root = fixture.root;

    const ctx = createContext(root);
    expect(ctx.plans).toHaveLength(1);

    // Add a new plan on disk
    const newDir = join(fixture.plansDir, 'b');
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(newDir, 'README.md'), '---\ntitle: Plan B\nstatus: not_started\ndepends_on:\n  - a\n---\n\n## Problem\n\n');

    const refreshed = refreshContext(ctx);

    expect(refreshed.plans).toHaveLength(2);
    expect(refreshed.graph.plans.has('b')).toBe(true);
    expect(refreshed.graph.ready.has('b')).toBe(true);
  });

  it('preserves config and projectDir from original context', () => {
    const fixture = createFixture([
      { id: 'x', title: 'X', status: 'not_started' },
    ]);
    root = fixture.root;

    const ctx = createContext(root);
    const refreshed = refreshContext(ctx);

    expect(refreshed.projectDir).toBe(ctx.projectDir);
    expect(refreshed.config).toBe(ctx.config);
    expect(refreshed.plansDir).toBe(ctx.plansDir);
  });

  it('reflects status changes on disk', () => {
    const fixture = createFixture([
      { id: 'dep', title: 'Dep', status: 'not_started' },
      { id: 'child', title: 'Child', status: 'not_started', depends_on: ['dep'] },
    ]);
    root = fixture.root;

    const ctx = createContext(root);
    expect(ctx.graph.blocked.has('child')).toBe(true);

    // Manually update dep to done on disk
    writeFileSync(
      join(fixture.plansDir, 'dep', 'README.md'),
      '---\ntitle: Dep\nstatus: done\n---\n\n## Problem\n\n',
    );

    const refreshed = refreshContext(ctx);
    expect(refreshed.graph.blocked.has('child')).toBe(false);
    expect(refreshed.graph.ready.has('child')).toBe(true);
  });
});

describe('createContextAsync', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('matches sync createContext output', async () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    root = fixture.root;

    const sync = createContext(root);
    const async_ = await createContextAsync(root);

    expect(async_.projectDir).toBe(sync.projectDir);
    expect(async_.config).toEqual(sync.config);
    expect(async_.plansDir).toBe(sync.plansDir);
    expect(async_.plans).toHaveLength(sync.plans.length);
    expect(async_.graph.plans.size).toBe(sync.graph.plans.size);
    expect(async_.graph.ready.has('b')).toBe(true);
    expect(async_.isProjectMode).toBe(false);
  });

  it('detects blocked plans', async () => {
    const fixture = createFixture([
      { id: 'dep', title: 'Dep', status: 'not_started' },
      { id: 'child', title: 'Child', status: 'not_started', depends_on: ['dep'] },
    ]);
    root = fixture.root;

    const ctx = await createContextAsync(root);

    expect(ctx.graph.blocked.has('child')).toBe(true);
    expect(ctx.graph.ready.has('dep')).toBe(true);
  });

  it('returns default config when .trellis is missing', async () => {
    const { mkdtempSync } = require('fs');
    const { tmpdir } = require('os');
    root = mkdtempSync(join(tmpdir(), 'trellis-ctx-async-'));
    mkdirSync(join(root, 'plans'), { recursive: true });

    const ctx = await createContextAsync(root);
    expect(ctx.config.plans_dir).toBe('plans');
    expect(ctx.plans).toHaveLength(0);
  });
});

describe('refreshContextAsync', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('picks up new plans added after initial scan', async () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
    ]);
    root = fixture.root;

    const ctx = await createContextAsync(root);
    expect(ctx.plans).toHaveLength(1);

    // Add a new plan on disk
    const newDir = join(fixture.plansDir, 'b');
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(newDir, 'README.md'), '---\ntitle: Plan B\nstatus: not_started\ndepends_on:\n  - a\n---\n\n## Problem\n\n');

    const refreshed = await refreshContextAsync(ctx);

    expect(refreshed.plans).toHaveLength(2);
    expect(refreshed.graph.plans.has('b')).toBe(true);
    expect(refreshed.graph.ready.has('b')).toBe(true);
  });

  it('preserves config and projectDir from original context', async () => {
    const fixture = createFixture([
      { id: 'x', title: 'X', status: 'not_started' },
    ]);
    root = fixture.root;

    const ctx = await createContextAsync(root);
    const refreshed = await refreshContextAsync(ctx);

    expect(refreshed.projectDir).toBe(ctx.projectDir);
    expect(refreshed.config).toEqual(ctx.config);
    expect(refreshed.plansDir).toBe(ctx.plansDir);
  });

  it('reflects status changes on disk', async () => {
    const fixture = createFixture([
      { id: 'dep', title: 'Dep', status: 'not_started' },
      { id: 'child', title: 'Child', status: 'not_started', depends_on: ['dep'] },
    ]);
    root = fixture.root;

    const ctx = await createContextAsync(root);
    expect(ctx.graph.blocked.has('child')).toBe(true);

    writeFileSync(
      join(fixture.plansDir, 'dep', 'README.md'),
      '---\ntitle: Dep\nstatus: done\n---\n\n## Problem\n\n',
    );

    const refreshed = await refreshContextAsync(ctx);
    expect(refreshed.graph.blocked.has('child')).toBe(false);
    expect(refreshed.graph.ready.has('child')).toBe(true);
  });
});

describe('createMultiContextAsync', () => {
  let fixture: ReturnType<typeof createTestFixture>;

  afterEach(() => {
    if (fixture) {
      for (const repo of fixture.repos) {
        rmSync(repo.root, { recursive: true, force: true });
      }
      rmSync(fixture.cacheDir, { recursive: true, force: true });
    }
  });

  it('matches sync createMultiContext output', async () => {
    fixture = createTestFixture(2, 3);

    const sync = createMultiContext(fixture.repoSpecs);
    const async_ = await createMultiContextAsync(fixture.repoSpecs);

    expect(async_.plans).toHaveLength(sync.plans.length);
    expect(async_.graph.plans.size).toBe(sync.graph.plans.size);
    expect(async_.repos).toHaveLength(sync.repos.length);

    for (const repo of async_.repos) {
      const syncRepo = sync.repos.find(r => r.alias === repo.alias);
      expect(syncRepo).toBeDefined();
      expect(repo.planCount).toBe(syncRepo!.planCount);
      expect(repo.configFound).toBe(syncRepo!.configFound);
    }
  });

  it('throws on duplicate aliases', async () => {
    fixture = createTestFixture(1, 1);
    const dupes = [fixture.repoSpecs[0], { ...fixture.repoSpecs[0] }];

    await expect(createMultiContextAsync(dupes)).rejects.toThrow('Duplicate alias');
  });

  it('handles missing repo paths gracefully', async () => {
    fixture = createTestFixture(1, 2);
    const specs = [
      fixture.repoSpecs[0],
      { path: '/nonexistent/path', alias: 'bad-repo' },
    ];

    const ctx = await createMultiContextAsync(specs);

    // Good repo should have its plans
    const goodRepo = ctx.repos.find(r => r.alias === fixture.repoSpecs[0].alias);
    expect(goodRepo).toBeDefined();
    expect(goodRepo!.planCount).toBe(2);

    // Bad repo should be present with 0 plans (scanPlansAsync degrades gracefully)
    const badRepo = ctx.repos.find(r => r.alias === 'bad-repo');
    expect(badRepo).toBeDefined();
    expect(badRepo!.planCount).toBe(0);
    expect(badRepo!.configFound).toBe(false);
  });
});
