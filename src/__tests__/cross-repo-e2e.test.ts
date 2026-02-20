import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { createContext, readCache, writeCache } from '../core/index.ts';

/**
 * E2E tests for cross-repo graph using file:// git URLs.
 *
 * Structure:
 *   /tmp/trellis-e2e-xyz/
 *     bare/
 *       meta.git/         # bare repo for .trellis-project manifest
 *       canopy.git/       # bare repo simulating canopy remote
 *     working/
 *       local/            # cloned workspace running trellis
 */

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] });
}

function initBareRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  git(['init', '--bare'], path);
}

function initWorkingRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  git(['init'], path);
  git(['config', 'user.email', 'test@test.com'], path);
  git(['config', 'user.name', 'Test'], path);
}

interface ProjectFixture {
  root: string;
  bareDir: string;
  localDir: string;
  metaUrl: string;
  canopyUrl: string;
}

function createProjectFixture(): ProjectFixture {
  const root = mkdtempSync(join(tmpdir(), 'trellis-e2e-'));
  const bareDir = join(root, 'bare');
  const metaPath = join(bareDir, 'meta.git');
  const canopyPath = join(bareDir, 'canopy.git');
  const localDir = join(root, 'working', 'local');

  // Create bare repos
  initBareRepo(metaPath);
  initBareRepo(canopyPath);

  // Set up the manifest in meta repo
  const metaWork = join(root, 'tmp-meta');
  initWorkingRepo(metaWork);
  writeFileSync(join(metaWork, '.trellis-project'), [
    'name: test-project',
    'repos:',
    '  local:',
    `    url: file://${join(root, 'working', 'local')}`,
    '    branch: main',
    '    visibility: public',
    '  canopy:',
    `    url: file://${canopyPath}`,
    '    branch: main',
    '    visibility: public',
  ].join('\n'));
  git(['add', '.'], metaWork);
  git(['commit', '-m', 'init manifest'], metaWork);
  git(['push', `file://${metaPath}`, 'HEAD:main'], metaWork);

  // Set up canopy with plans
  const canopyWork = join(root, 'tmp-canopy');
  initWorkingRepo(canopyWork);
  mkdirSync(join(canopyWork, 'plans', 'ui-lib'), { recursive: true });
  writeFileSync(join(canopyWork, 'plans', 'ui-lib', 'README.md'), [
    '---',
    'title: UI Library',
    'status: done',
    '---',
    '',
    '## Problem',
    '',
    'Need a UI library.',
  ].join('\n'));
  mkdirSync(join(canopyWork, 'plans', 'core-utils'), { recursive: true });
  writeFileSync(join(canopyWork, 'plans', 'core-utils', 'README.md'), [
    '---',
    'title: Core Utils',
    'status: in_progress',
    'depends_on:',
    '  - ui-lib',
    '---',
    '',
    '## Problem',
    '',
    'Need core utilities.',
  ].join('\n'));
  // A canopy plan that depends back on a local plan (remote-to-local dep)
  mkdirSync(join(canopyWork, 'plans', 'integration'), { recursive: true });
  writeFileSync(join(canopyWork, 'plans', 'integration', 'README.md'), [
    '---',
    'title: Integration Tests',
    'status: not_started',
    'depends_on:',
    '  - local:auth',
    '---',
    '',
    '## Problem',
    '',
    'Need integration tests that depend on local auth.',
  ].join('\n'));
  git(['add', '.'], canopyWork);
  git(['commit', '-m', 'init canopy plans'], canopyWork);
  git(['push', `file://${canopyPath}`, 'HEAD:main'], canopyWork);

  // Set up local working repo
  initWorkingRepo(localDir);
  mkdirSync(join(localDir, '.trellis'), { recursive: true });
  writeFileSync(join(localDir, '.trellis', 'config'), [
    'project: local',
    'plans_dir: plans',
    `manifest: file://${metaPath}`,
  ].join('\n'));
  writeFileSync(join(localDir, '.trellis', '.gitignore'), 'cache/\n');
  mkdirSync(join(localDir, 'plans', 'auth'), { recursive: true });
  writeFileSync(join(localDir, 'plans', 'auth', 'README.md'), [
    '---',
    'title: Authentication',
    'status: not_started',
    'depends_on:',
    '  - canopy:ui-lib',
    '---',
    '',
    '## Problem',
    '',
    'Need auth system.',
  ].join('\n'));
  mkdirSync(join(localDir, 'plans', 'settings'), { recursive: true });
  writeFileSync(join(localDir, 'plans', 'settings', 'README.md'), [
    '---',
    'title: Settings Page',
    'status: not_started',
    'depends_on:',
    '  - canopy:core-utils',
    '---',
    '',
    '## Problem',
    '',
    'Need settings page.',
  ].join('\n'));
  git(['add', '.'], localDir);
  git(['commit', '-m', 'init local'], localDir);

  const metaUrl = `file://${metaPath}`;
  const canopyUrl = `file://${canopyPath}`;

  return { root, bareDir, localDir, metaUrl, canopyUrl };
}

describe('cross-repo E2E', () => {
  let fixture: ProjectFixture;

  beforeEach(() => {
    fixture = createProjectFixture();
  });

  afterEach(() => {
    rmSync(fixture.root, { recursive: true, force: true });
  });

  it('fetches remote plans and builds unified context', () => {
    const ctx = createContext(fixture.localDir);

    // Should have local plans + remote plans
    expect(ctx.plans.length).toBeGreaterThanOrEqual(5); // 2 local + 3 remote
    expect(ctx.manifest).toBeDefined();

    // Remote plans should have qualified IDs
    const remoteIds = ctx.plans.filter(p => p.repoAlias != null).map(p => p.id);
    expect(remoteIds).toContain('canopy:ui-lib');
    expect(remoteIds).toContain('canopy:core-utils');
    expect(remoteIds).toContain('canopy:integration');

    // Local plans keep unqualified IDs
    const localIds = ctx.plans.filter(p => p.repoAlias == null).map(p => p.id);
    expect(localIds).toContain('auth');
    expect(localIds).toContain('settings');
  });

  it('cross-repo dep satisfied: local plan shows as ready', () => {
    const ctx = createContext(fixture.localDir);

    // auth depends on canopy:ui-lib (status: done) → should be ready
    expect(ctx.graph.ready.has('auth')).toBe(true);
    expect(ctx.graph.blocked.has('auth')).toBe(false);
  });

  it('cross-repo dep unsatisfied: local plan is blocked', () => {
    const ctx = createContext(fixture.localDir);

    // settings depends on canopy:core-utils (status: in_progress) → should be blocked
    expect(ctx.graph.blocked.has('settings')).toBe(true);
    expect(ctx.graph.ready.has('settings')).toBe(false);
  });

  it('remote-to-remote deps resolve correctly', () => {
    const ctx = createContext(fixture.localDir);

    // canopy:core-utils depends on canopy:ui-lib (intra-repo dep, qualified)
    const deps = ctx.graph.dependencies.get('canopy:core-utils') ?? [];
    expect(deps).toContain('canopy:ui-lib');
  });

  it('caches remote plans after first fetch', () => {
    // First call fetches
    createContext(fixture.localDir);

    // Cache should exist
    const cached = readCache(fixture.localDir, 'plans/canopy');
    expect(cached).not.toBeNull();
    expect(cached!.data).toHaveLength(3);

    const manifestCache = readCache(fixture.localDir, 'manifest');
    expect(manifestCache).not.toBeNull();
    expect(manifestCache!.data).toHaveProperty('name', 'test-project');
  });

  it('second createContext uses cache (no re-fetch)', () => {
    // First call
    const ctx1 = createContext(fixture.localDir);

    // Second call should use cache and produce same result
    const ctx2 = createContext(fixture.localDir);
    expect(ctx2.plans.length).toBe(ctx1.plans.length);
    expect(ctx2.graph.ready.has('auth')).toBe(ctx1.graph.ready.has('auth'));
  });

  it('trellis show resolves qualified IDs', () => {
    const ctx = createContext(fixture.localDir);

    const plan = ctx.graph.plans.get('canopy:ui-lib');
    expect(plan).toBeDefined();
    expect(plan!.frontmatter.title).toBe('UI Library');
    expect(plan!.frontmatter.status).toBe('done');
  });

  it('remote-to-local dep resolves correctly (local alias stripped)', () => {
    const ctx = createContext(fixture.localDir);

    // canopy:integration has depends_on: [local:auth]
    // 'local' is the local project alias, so this should resolve to unqualified 'auth'
    const integrationDeps = ctx.graph.dependencies.get('canopy:integration') ?? [];
    expect(integrationDeps).toContain('auth');
    // Should NOT have the qualified form as a dangling ref
    expect(integrationDeps).not.toContain('local:auth');

    // auth should list canopy:integration as a dependent
    const authDependents = ctx.graph.dependents.get('auth') ?? [];
    expect(authDependents).toContain('canopy:integration');
  });

  it('--offline uses cache when available', () => {
    // First call populates cache
    createContext(fixture.localDir);

    // Offline call should use cache
    const ctx = createContext(fixture.localDir, { offline: true });
    const remoteIds = ctx.plans.filter(p => p.repoAlias != null).map(p => p.id);
    expect(remoteIds).toContain('canopy:ui-lib');
    expect(remoteIds).toContain('canopy:core-utils');
  });

  it('--offline with empty cache degrades to local-only', () => {
    // Don't fetch first — go straight to offline
    const ctx = createContext(fixture.localDir, { offline: true });

    // Should only have local plans
    const ids = ctx.plans.map(p => p.id);
    expect(ids).toContain('auth');
    expect(ids).toContain('settings');
    expect(ids.some(id => id.startsWith('canopy:'))).toBe(false);
  });
});
