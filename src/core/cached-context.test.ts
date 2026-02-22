import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, utimesSync, renameSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createCachedContext, createCachedContextAsync } from './cached-context.ts';
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
  it('has projectDir, config, plansDir, plans, graph, isProjectMode', () => {
    const { root, plansDir } = createSingleRepoFixture(2);

    const { ctx } = createCachedContext(root);

    expect(ctx.projectDir).toBe(root);
    expect(ctx.config.project).toBe('test-project');
    expect(ctx.plansDir).toBe(plansDir);
    expect(ctx.plans.length).toBe(2);
    expect(ctx.graph).toBeDefined();
    expect(ctx.isProjectMode).toBe(false);
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

// --- Project mode auto-detection ---

describe('createCachedContext project mode', () => {
  function setupProjectFixture() {
    const alpha = createFixture([
      { id: 'auth', title: 'Auth', status: 'not_started', body: '\n## Problem\nAuth\n\n## Approach\nJWT\n' },
    ]);
    const beta = createFixture([
      { id: 'ui', title: 'UI', status: 'not_started', body: '\n## Problem\nUI\n\n## Approach\nReact\n' },
      { id: 'dashboard', title: 'Dashboard', status: 'not_started', depends_on: ['alpha:auth'], body: '\n## Problem\nDash\n\n## Approach\nBuild\n' },
    ]);

    // Configure alpha as project root with manifest
    writeFileSync(
      join(alpha.root, '.trellis', 'config'),
      `project: alpha\nplans_dir: plans\nmanifest: https://example.com/manifest.git\n`,
    );

    // Write .trellis-project manifest
    const manifest = [
      'name: test-project',
      'repos:',
      '  alpha:',
      `    path: ${alpha.root}`,
      '  beta:',
      `    path: ${beta.root}`,
    ].join('\n');
    writeFileSync(join(alpha.root, '.trellis-project'), manifest);

    return { alpha, beta };
  }

  it('enters project mode when manifest + .trellis-project exist', () => {
    const { alpha } = setupProjectFixture();

    const { ctx } = createCachedContext(alpha.root);

    expect(ctx.plans.length).toBe(3);
    expect(ctx.isProjectMode).toBe(true);
    // Plans should be qualified
    const ids = ctx.plans.map(p => p.id);
    expect(ids).toContain('alpha:auth');
    expect(ids).toContain('beta:ui');
    expect(ids).toContain('beta:dashboard');
  });

  it('resolves cross-repo dependencies in project mode', () => {
    const { alpha } = setupProjectFixture();

    const { ctx } = createCachedContext(alpha.root);

    // beta:dashboard depends on alpha:auth
    const dashboard = ctx.plans.find(p => p.id === 'beta:dashboard');
    expect(dashboard).toBeDefined();
    expect(dashboard!.frontmatter.depends_on).toContain('alpha:auth');

    // alpha:auth is not done, so beta:dashboard should be blocked
    expect(ctx.graph.blocked.has('beta:dashboard')).toBe(true);
  });

  it('returns manifest in context', () => {
    const { alpha } = setupProjectFixture();

    const { ctx } = createCachedContext(alpha.root);

    expect(ctx.manifest).toBeDefined();
    expect(ctx.manifest!.name).toBe('test-project');
  });

  it('falls back to single-repo when manifest configured but no .trellis-project', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    writeFileSync(
      join(root, '.trellis', 'config'),
      'project: test-project\nplans_dir: plans\nmanifest: https://example.com/manifest.git\n',
    );

    // No .trellis-project file — should fall back to single-repo silently
    const { ctx } = createCachedContext(root);

    expect(ctx.plans.length).toBe(1);
    expect(ctx.plans[0].id).toBe('test');
  });

  it('warns and continues with available repos when some are missing', () => {
    const alpha = createFixture([
      { id: 'auth', title: 'Auth', status: 'not_started', body: '\n## Problem\nAuth\n\n## Approach\nJWT\n' },
    ]);

    writeFileSync(
      join(alpha.root, '.trellis', 'config'),
      `project: alpha\nplans_dir: plans\nmanifest: https://example.com/manifest.git\n`,
    );
    writeFileSync(
      join(alpha.root, '.trellis-project'),
      [
        'name: test-project',
        'repos:',
        '  alpha:',
        `    path: ${alpha.root}`,
        '  missing-repo:',
        '    path: /nonexistent/path',
      ].join('\n'),
    );

    const { ctx } = createCachedContext(alpha.root);

    // Should include alpha plans despite missing-repo
    expect(ctx.plans.length).toBe(1);
    expect(ctx.plans[0].id).toBe('alpha:auth');
  });

  it('persists cache in project mode', async () => {
    const { alpha } = setupProjectFixture();

    const { persist } = createCachedContext(alpha.root);
    await persist();

    const indexPath = join(alpha.root, '.trellis', 'cache', 'context-store.json');
    expect(existsSync(indexPath)).toBe(true);
  });

  it('warm cache returns same plans without rescan in project mode', async () => {
    const { alpha } = setupProjectFixture();

    // Cold start — populates cache
    const { ctx: ctx1, persist } = createCachedContext(alpha.root);
    await persist();

    const scanSpy = vi.spyOn(await import('./scanner.ts'), 'scanPlans');

    // Warm cache — should not rescan
    const { ctx: ctx2 } = createCachedContext(alpha.root);

    expect(scanSpy).not.toHaveBeenCalled();
    scanSpy.mockRestore();

    // Same plans returned
    expect(ctx2.plans.length).toBe(ctx1.plans.length);
    expect(ctx2.plans.map(p => p.id).sort()).toEqual(ctx1.plans.map(p => p.id).sort());
    // Plans should still be qualified
    expect(ctx2.plans.some(p => p.id === 'alpha:auth')).toBe(true);
    expect(ctx2.plans.some(p => p.id === 'beta:ui')).toBe(true);
    expect(ctx2.plans.some(p => p.id === 'beta:dashboard')).toBe(true);
  });

  it('warm cache graph is valid in project mode', async () => {
    const { alpha } = setupProjectFixture();

    const { ctx: ctx1, persist } = createCachedContext(alpha.root);
    await persist();

    const { ctx: ctx2 } = createCachedContext(alpha.root);

    expect(ctx2.graph.plans.size).toBe(ctx1.graph.plans.size);
    expect([...ctx2.graph.ready].sort()).toEqual([...ctx1.graph.ready].sort());
    expect([...ctx2.graph.blocked].sort()).toEqual([...ctx1.graph.blocked].sort());
    // Cross-repo dep should still be resolved
    expect(ctx2.graph.blocked.has('beta:dashboard')).toBe(true);
  });
});

// --- project_root config field ---

describe('createCachedContext with project_root', () => {
  function setupProjectRootFixture() {
    // Create two repos: alpha (leaf) and beta
    const alpha = createFixture([
      { id: 'auth', title: 'Auth', status: 'not_started', body: '\n## Problem\nAuth\n\n## Approach\nJWT\n' },
    ]);
    const beta = createFixture([
      { id: 'ui', title: 'UI', status: 'not_started', body: '\n## Problem\nUI\n\n## Approach\nReact\n' },
      { id: 'dashboard', title: 'Dashboard', status: 'not_started', depends_on: ['alpha:auth'], body: '\n## Problem\nDash\n\n## Approach\nBuild\n' },
    ]);

    // Create a meta-repo directory with .trellis-project
    const metaRoot = mkdtempSync(join(tmpdir(), 'trellis-meta-'));
    const manifest = [
      'name: test-project',
      'repos:',
      '  alpha:',
      `    path: ${alpha.root}`,
      '  beta:',
      `    path: ${beta.root}`,
    ].join('\n');
    writeFileSync(join(metaRoot, '.trellis-project'), manifest);

    // Configure alpha as a LEAF repo with project_root pointing to metaRoot
    writeFileSync(
      join(alpha.root, '.trellis', 'config'),
      `project: alpha\nplans_dir: plans\nproject_root: ${metaRoot}\n`,
    );

    return { alpha, beta, metaRoot };
  }

  it('enters project mode from leaf repo via project_root', () => {
    const { alpha } = setupProjectRootFixture();

    const { ctx } = createCachedContext(alpha.root);

    expect(ctx.plans.length).toBe(3);
    expect(ctx.isProjectMode).toBe(true);
    const ids = ctx.plans.map(p => p.id);
    expect(ids).toContain('alpha:auth');
    expect(ids).toContain('beta:ui');
    expect(ids).toContain('beta:dashboard');
  });

  it('resolves cross-repo dependencies via project_root', () => {
    const { alpha } = setupProjectRootFixture();

    const { ctx } = createCachedContext(alpha.root);

    // beta:dashboard depends on alpha:auth (not done) → should be blocked
    expect(ctx.graph.blocked.has('beta:dashboard')).toBe(true);
  });

  it('returns manifest in context via project_root', () => {
    const { alpha } = setupProjectRootFixture();

    const { ctx } = createCachedContext(alpha.root);

    expect(ctx.manifest).toBeDefined();
    expect(ctx.manifest!.name).toBe('test-project');
  });

  it('falls back to single-repo when project_root .trellis-project missing', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const emptyDir = mkdtempSync(join(tmpdir(), 'trellis-empty-'));
    writeFileSync(
      join(root, '.trellis', 'config'),
      `project: test-project\nplans_dir: plans\nproject_root: ${emptyDir}\n`,
    );

    // project_root dir has no .trellis-project → should fall back to single-repo
    const { ctx } = createCachedContext(root);

    expect(ctx.plans.length).toBe(1);
    expect(ctx.plans[0].id).toBe('test');
  });

  it('persists cache in leaf repo, not meta-repo', async () => {
    const { alpha, metaRoot } = setupProjectRootFixture();

    const { persist } = createCachedContext(alpha.root);
    await persist();

    // Cache should be in the leaf repo
    const leafCachePath = join(alpha.root, '.trellis', 'cache', 'context-store.json');
    expect(existsSync(leafCachePath)).toBe(true);

    // Meta-repo should NOT have a cache
    const metaCachePath = join(metaRoot, '.trellis', 'cache', 'context-store.json');
    expect(existsSync(metaCachePath)).toBe(false);
  });

  it('--no-cache with project_root still returns isProjectMode true', () => {
    const { alpha } = setupProjectRootFixture();

    const { ctx } = createCachedContext(alpha.root, { noCache: true });

    expect(ctx.isProjectMode).toBe(true);
    expect(ctx.plans.length).toBe(3);
    const ids = ctx.plans.map(p => p.id);
    expect(ids).toContain('alpha:auth');
    expect(ids).toContain('beta:ui');
    expect(ids).toContain('beta:dashboard');
  });

  it('--no-cache with project_root does not persist', async () => {
    const { alpha } = setupProjectRootFixture();

    const { persist } = createCachedContext(alpha.root, { noCache: true });
    await persist();

    const indexPath = join(alpha.root, '.trellis', 'cache', 'context-store.json');
    expect(existsSync(indexPath)).toBe(false);
  });

  it('warm cache works with project_root', async () => {
    const { alpha } = setupProjectRootFixture();

    // Cold start
    const { ctx: ctx1, persist } = createCachedContext(alpha.root);
    await persist();

    const scanSpy = vi.spyOn(await import('./scanner.ts'), 'scanPlans');

    // Warm cache
    const { ctx: ctx2 } = createCachedContext(alpha.root);

    expect(scanSpy).not.toHaveBeenCalled();
    scanSpy.mockRestore();

    expect(ctx2.plans.length).toBe(ctx1.plans.length);
    expect(ctx2.plans.map(p => p.id).sort()).toEqual(ctx1.plans.map(p => p.id).sort());
  });
});

// --- Async variant ---

describe('createCachedContextAsync', () => {
  it('matches sync createCachedContext output', async () => {
    const { root } = createSingleRepoFixture(3);

    const { ctx: syncCtx } = createCachedContext(root);
    const { ctx: asyncCtx } = await createCachedContextAsync(root);

    expect(asyncCtx.plans.map(p => p.id).sort()).toEqual(syncCtx.plans.map(p => p.id).sort());
    expect(asyncCtx.graph.plans.size).toBe(syncCtx.graph.plans.size);
    expect([...asyncCtx.graph.ready].sort()).toEqual([...syncCtx.graph.ready].sort());
    expect([...asyncCtx.graph.blocked].sort()).toEqual([...syncCtx.graph.blocked].sort());
    expect(asyncCtx.isProjectMode).toBe(false);
  });

  it('cold start output matches createContext', async () => {
    const { root } = createSingleRepoFixture(3);

    const { ctx: cached } = await createCachedContextAsync(root);
    const direct = createContext(root, { offline: true });

    expect(cached.plans.map(p => p.id).sort()).toEqual(direct.plans.map(p => p.id).sort());
    expect(cached.graph.plans.size).toBe(direct.graph.plans.size);
  });

  it('--no-cache forces full rescan', async () => {
    const { root } = createSingleRepoFixture(2);

    const { persist } = await createCachedContextAsync(root);
    await persist();

    const scanSpy = vi.spyOn(await import('./scanner.ts'), 'scanPlansAsync');

    await createCachedContextAsync(root, { noCache: true });

    expect(scanSpy).toHaveBeenCalled();
    scanSpy.mockRestore();
  });

  it('persist and warm cache round-trip', async () => {
    const { root } = createSingleRepoFixture(3);

    const { ctx: ctx1, persist } = await createCachedContextAsync(root);
    await persist();

    // Second call (sync) should use cache from async persist
    const { ctx: ctx2 } = createCachedContext(root);

    expect(ctx2.plans.map(p => p.id).sort()).toEqual(ctx1.plans.map(p => p.id).sort());
  });

  it('project mode via manifest', async () => {
    const alpha = createFixture([
      { id: 'auth', title: 'Auth', status: 'not_started', body: '\n## Problem\nAuth\n\n## Approach\nJWT\n' },
    ]);
    const beta = createFixture([
      { id: 'ui', title: 'UI', status: 'not_started', body: '\n## Problem\nUI\n\n## Approach\nReact\n' },
    ]);

    writeFileSync(
      join(alpha.root, '.trellis', 'config'),
      `project: alpha\nplans_dir: plans\nmanifest: https://example.com/manifest.git\n`,
    );
    writeFileSync(
      join(alpha.root, '.trellis-project'),
      [
        'name: test-project',
        'repos:',
        '  alpha:',
        `    path: ${alpha.root}`,
        '  beta:',
        `    path: ${beta.root}`,
      ].join('\n'),
    );

    const { ctx } = await createCachedContextAsync(alpha.root);

    expect(ctx.plans.length).toBe(2);
    expect(ctx.isProjectMode).toBe(true);
    const ids = ctx.plans.map(p => p.id);
    expect(ids).toContain('alpha:auth');
    expect(ids).toContain('beta:ui');
  });

  function setupAsyncProjectRootFixture() {
    const alpha = createFixture([
      { id: 'auth', title: 'Auth', status: 'not_started', body: '\n## Problem\nAuth\n\n## Approach\nJWT\n' },
    ]);
    const beta = createFixture([
      { id: 'ui', title: 'UI', status: 'not_started', body: '\n## Problem\nUI\n\n## Approach\nReact\n' },
      { id: 'dashboard', title: 'Dashboard', status: 'not_started', depends_on: ['alpha:auth'], body: '\n## Problem\nDash\n\n## Approach\nBuild\n' },
    ]);
    const metaRoot = mkdtempSync(join(tmpdir(), 'trellis-meta-'));
    const manifest = [
      'name: test-project',
      'repos:',
      '  alpha:',
      `    path: ${alpha.root}`,
      '  beta:',
      `    path: ${beta.root}`,
    ].join('\n');
    writeFileSync(join(metaRoot, '.trellis-project'), manifest);
    writeFileSync(
      join(alpha.root, '.trellis', 'config'),
      `project: alpha\nplans_dir: plans\nproject_root: ${metaRoot}\n`,
    );
    return { alpha, beta, metaRoot };
  }

  it('enters project mode via project_root', async () => {
    const { alpha } = setupAsyncProjectRootFixture();

    const { ctx } = await createCachedContextAsync(alpha.root);

    expect(ctx.plans.length).toBe(3);
    expect(ctx.isProjectMode).toBe(true);
    const ids = ctx.plans.map(p => p.id);
    expect(ids).toContain('alpha:auth');
    expect(ids).toContain('beta:ui');
    expect(ids).toContain('beta:dashboard');
  });

  it('resolves cross-repo dependencies in project mode', async () => {
    const { alpha } = setupAsyncProjectRootFixture();

    const { ctx } = await createCachedContextAsync(alpha.root);

    // beta:dashboard depends on alpha:auth (not done) → should be blocked
    expect(ctx.graph.blocked.has('beta:dashboard')).toBe(true);
    expect(ctx.graph.ready.has('alpha:auth')).toBe(true);
  });

  it('--no-cache does not persist', async () => {
    const { root } = createSingleRepoFixture(2);

    const { persist } = await createCachedContextAsync(root, { noCache: true });
    await persist();

    const cacheDir = join(root, '.trellis', 'cache');
    const indexPath = join(cacheDir, 'context-store.json');
    expect(existsSync(indexPath)).toBe(false);
  });

  it('continues with available repos when some are missing', async () => {
    const alpha = createFixture([
      { id: 'auth', title: 'Auth', status: 'not_started', body: '\n## Problem\nAuth\n\n## Approach\nJWT\n' },
    ]);

    writeFileSync(
      join(alpha.root, '.trellis', 'config'),
      `project: alpha\nplans_dir: plans\nmanifest: https://example.com/manifest.git\n`,
    );
    writeFileSync(
      join(alpha.root, '.trellis-project'),
      [
        'name: test-project',
        'repos:',
        '  alpha:',
        `    path: ${alpha.root}`,
        '  missing-repo:',
        '    path: /nonexistent/path',
      ].join('\n'),
    );

    const { ctx } = await createCachedContextAsync(alpha.root);

    expect(ctx.plans.length).toBe(1);
    expect(ctx.plans[0].id).toBe('alpha:auth');
  });

  it('persist writes index file', async () => {
    const alpha = createFixture([
      { id: 'auth', title: 'Auth', status: 'not_started', body: '\n## Problem\nAuth\n\n## Approach\nJWT\n' },
    ]);
    const beta = createFixture([
      { id: 'ui', title: 'UI', status: 'not_started', body: '\n## Problem\nUI\n\n## Approach\nReact\n' },
    ]);

    writeFileSync(
      join(alpha.root, '.trellis', 'config'),
      `project: alpha\nplans_dir: plans\nmanifest: https://example.com/manifest.git\n`,
    );
    writeFileSync(
      join(alpha.root, '.trellis-project'),
      [
        'name: test-project',
        'repos:',
        '  alpha:',
        `    path: ${alpha.root}`,
        '  beta:',
        `    path: ${beta.root}`,
      ].join('\n'),
    );

    const { persist } = await createCachedContextAsync(alpha.root);
    await persist();

    const indexPath = join(alpha.root, '.trellis', 'cache', 'context-store.json');
    expect(existsSync(indexPath)).toBe(true);
  });
});
