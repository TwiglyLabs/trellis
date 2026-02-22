import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, utimesSync, renameSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createCachedContext } from './cached-context.ts';
import { createContext } from './context.ts';
import { createFixture } from '../__tests__/helpers.ts';

function createSingleRepoFixture(planCount: number) {
  const root = mkdtempSync(join(tmpdir(), 'trellis-cached-'));
  const plansDir = join(root, 'plans');
  mkdirSync(plansDir, { recursive: true });

  mkdirSync(join(root, '.trellis'), { recursive: true });
  writeFileSync(
    join(root, '.trellis', 'config'),
    'project: test-project\nplans_dir: plans\n',
  );

  for (let i = 0; i < planCount; i++) {
    const planDir = join(plansDir, `plan-${i}`);
    mkdirSync(planDir, { recursive: true });

    const depends = i > 0 ? `\ndepends_on:\n  - plan-${i - 1}` : '';
    const status = i === 0 ? 'done' : 'not_started';

    writeFileSync(
      join(planDir, 'README.md'),
      `---\ntitle: Plan ${i}\nstatus: ${status}${depends}\n---\n\n## Problem\nTest plan ${i}\n\n## Approach\nTest approach ${i}\n`,
    );

    writeFileSync(
      join(planDir, 'implementation.md'),
      `## Steps\nStep 1\n\n## Testing\nTest case 1\n\n## Done-when\n- [ ] Done\n`,
    );
  }

  return { root, plansDir };
}

// --- Cache hit path ---

describe('createCachedContext cache hit', () => {
  it('returns cached plans when mtimes unchanged', async () => {
    const { root } = createSingleRepoFixture(3);

    // First call — cold start, populates cache
    const { ctx: ctx1, persist: persist1 } = createCachedContext(root);
    await persist1();

    // Second call — should use cache
    const { ctx: ctx2 } = createCachedContext(root);

    expect(ctx2.plans.length).toBe(ctx1.plans.length);
    expect(ctx2.plans.map(p => p.id).sort()).toEqual(ctx1.plans.map(p => p.id).sort());
  });

  it('plan IDs are unqualified in single-repo mode', async () => {
    const { root } = createSingleRepoFixture(2);

    const { ctx, persist } = createCachedContext(root);
    await persist();

    // IDs should NOT be qualified with repo alias
    expect(ctx.plans[0].id).not.toContain(':');
    expect(ctx.plans.some(p => p.id === 'plan-0')).toBe(true);
    expect(ctx.plans.some(p => p.id === 'plan-1')).toBe(true);
  });

  it('scanPlans is NOT called on cache hit', async () => {
    const { root } = createSingleRepoFixture(2);

    const { persist } = createCachedContext(root);
    await persist();

    const scanSpy = vi.spyOn(await import('./scanner.ts'), 'scanPlans');

    createCachedContext(root);

    expect(scanSpy).not.toHaveBeenCalled();
    scanSpy.mockRestore();
  });

  it('graph is valid on cache hit', async () => {
    const { root } = createSingleRepoFixture(3);

    const { ctx: ctx1, persist } = createCachedContext(root);
    await persist();

    const { ctx: ctx2 } = createCachedContext(root);

    expect(ctx2.graph.plans.size).toBe(ctx1.graph.plans.size);
    expect([...ctx2.graph.ready].sort()).toEqual([...ctx1.graph.ready].sort());
    expect([...ctx2.graph.blocked].sort()).toEqual([...ctx1.graph.blocked].sort());
  });
});

// --- Cache miss path ---

describe('createCachedContext cache miss', () => {
  it('rescans when plan file mtime changes', async () => {
    const { root, plansDir } = createSingleRepoFixture(2);

    const { persist } = createCachedContext(root);
    await persist();

    // Touch a plan file
    const readmePath = join(plansDir, 'plan-0', 'README.md');
    const future = new Date(Date.now() + 2000);
    utimesSync(readmePath, future, future);

    const scanSpy = vi.spyOn(await import('./scanner.ts'), 'scanPlans');

    createCachedContext(root);

    expect(scanSpy).toHaveBeenCalled();
    scanSpy.mockRestore();
  });

  it('rescans when config mtime changes', async () => {
    const { root } = createSingleRepoFixture(2);

    const { persist } = createCachedContext(root);
    await persist();

    // Touch the config file
    const configPath = join(root, '.trellis', 'config');
    const future = new Date(Date.now() + 2000);
    utimesSync(configPath, future, future);

    const scanSpy = vi.spyOn(await import('./scanner.ts'), 'scanPlans');

    createCachedContext(root);

    expect(scanSpy).toHaveBeenCalled();
    scanSpy.mockRestore();
  });

  it('reflects new plans after rescan', async () => {
    const { root, plansDir } = createSingleRepoFixture(2);

    const { persist } = createCachedContext(root);
    await persist();

    // Add a new plan
    const newPlanDir = join(plansDir, 'new-plan');
    mkdirSync(newPlanDir, { recursive: true });
    writeFileSync(
      join(newPlanDir, 'README.md'),
      '---\ntitle: New Plan\nstatus: draft\n---\n\n## Problem\nNew\n',
    );

    const { ctx } = createCachedContext(root);

    expect(ctx.plans.length).toBe(3);
    expect(ctx.plans.some(p => p.id === 'new-plan')).toBe(true);
  });
});

// --- Cold start ---

describe('createCachedContext cold start', () => {
  it('works with no existing index (cold start)', () => {
    const { root } = createSingleRepoFixture(3);

    const { ctx } = createCachedContext(root);

    expect(ctx.plans.length).toBe(3);
    expect(ctx.graph.plans.size).toBe(3);
  });

  it('cold start output matches createContext output', () => {
    const { root } = createSingleRepoFixture(3);

    const { ctx: cached } = createCachedContext(root);
    const direct = createContext(root, { offline: true });

    expect(cached.plans.map(p => p.id).sort()).toEqual(direct.plans.map(p => p.id).sort());
    expect(cached.plans.map(p => p.frontmatter.title).sort()).toEqual(
      direct.plans.map(p => p.frontmatter.title).sort(),
    );
    expect(cached.graph.plans.size).toBe(direct.graph.plans.size);
    expect([...cached.graph.ready].sort()).toEqual([...direct.graph.ready].sort());
    expect([...cached.graph.blocked].sort()).toEqual([...direct.graph.blocked].sort());
  });
});

// --- --no-cache flag ---

describe('createCachedContext noCache flag', () => {
  it('--no-cache forces full rescan even with valid cache', async () => {
    const { root } = createSingleRepoFixture(2);

    const { persist } = createCachedContext(root);
    await persist();

    const scanSpy = vi.spyOn(await import('./scanner.ts'), 'scanPlans');

    createCachedContext(root, { noCache: true });

    expect(scanSpy).toHaveBeenCalled();
    scanSpy.mockRestore();
  });

  it('--no-cache does not persist', async () => {
    const { root } = createSingleRepoFixture(2);

    const { persist } = createCachedContext(root, { noCache: true });
    // persist should be a no-op
    await persist();

    const cacheDir = join(root, '.trellis', 'cache');
    const indexPath = join(cacheDir, 'context-store.json');
    expect(existsSync(indexPath)).toBe(false);
  });
});

// --- TrellisContext shape ---

describe('createCachedContext returns TrellisContext', () => {
  it('has projectDir, config, plansDir, plans, graph', () => {
    const { root, plansDir } = createSingleRepoFixture(2);

    const { ctx } = createCachedContext(root);

    expect(ctx.projectDir).toBe(root);
    expect(ctx.config.project).toBe('test-project');
    expect(ctx.plansDir).toBe(plansDir);
    expect(ctx.plans.length).toBe(2);
    expect(ctx.graph).toBeDefined();
  });
});

// --- Atomic writeCache ---

describe('writeCache atomicity', () => {
  it('writeCache uses atomic write (no .tmp files left)', () => {
    const { root } = createSingleRepoFixture(1);

    const { writeCache } = require('./cache.ts');
    writeCache(root, 'test-key', { hello: 'world' });

    const cacheDir = join(root, '.trellis', 'cache');
    const files = require('fs').readdirSync(cacheDir);
    const tmpFiles = files.filter((f: string) => f.endsWith('.tmp'));
    expect(tmpFiles).toEqual([]);

    // The actual file should exist
    expect(existsSync(join(cacheDir, 'test-key.json'))).toBe(true);
  });
});

// --- Performance ---

describe('createCachedContext performance', () => {
  it('warm cache completes in < 30ms', async () => {
    const { root } = createSingleRepoFixture(10);

    const { persist } = createCachedContext(root);
    await persist();

    const start = performance.now();
    createCachedContext(root);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(30);
  });
});

// --- createFixture compatibility ---

describe('createCachedContext with createFixture', () => {
  it('plans have no repoAlias in single-repo mode', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);

    const { ctx } = createCachedContext(root);

    expect(ctx.plans.length).toBe(2);
    expect(ctx.plans.some(p => p.id === 'a')).toBe(true);
    expect(ctx.plans.some(p => p.id === 'b')).toBe(true);
  });
});
