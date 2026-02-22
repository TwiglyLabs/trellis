import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseQualifiedId,
  mergeWithRemote,
  buildGraph,
  createContext,
  refreshContext,
  readCache,
  writeCache,
  checkVisibility,
  pickNext,
  computeCriticalPath,
  newlyReady,
} from '../core/index.ts';
import type { Plan, ProjectManifest } from '../core/types.ts';
import { computeUpdate } from '../features/update/logic.ts';
import { computeSet } from '../features/set/logic.ts';
import { computeWriteSection, computeWriteSections, computeReadSection } from '../features/sections/logic.ts';
import { computeRename } from '../features/rename/logic.ts';
import { computeArchive } from '../features/archive/logic.ts';
import { computeReady } from '../features/ready/logic.ts';
import { computeStatus } from '../features/status/logic.ts';
import { computeShow } from '../features/show/logic.ts';
import { computeLint } from '../features/lint/logic.ts';
import { createFixture } from './helpers.ts';

// --- Helpers ---

function makePlan(id: string, opts: {
  status?: string;
  depends_on?: string[];
  repoAlias?: string;
  remote?: boolean;
  tags?: string[];
} = {}): Plan {
  return {
    id,
    filePath: opts.repoAlias
      ? `trellis/${opts.repoAlias}/main:plans/${id}/README.md`
      : `plans/${id}/README.md`,
    frontmatter: {
      title: `Plan ${id}`,
      status: (opts.status ?? 'not_started') as any,
      depends_on: opts.depends_on,
      tags: opts.tags,
    },
    body: '',
    lineCount: 10,
    updatedAt: new Date(),
    fileHashes: {},
    repoAlias: opts.repoAlias,
    // Default remote=true when repoAlias is set (simulates fetchRepoPlans behavior)
    ...(opts.repoAlias && opts.remote !== false ? { remote: true } : {}),
  };
}

// =============================================
// parseQualifiedId
// =============================================

describe('parseQualifiedId', () => {
  it('returns local ref for unqualified ID', () => {
    const result = parseQualifiedId('auth');
    expect(result).toEqual({ planId: 'auth' });
    expect(result.repo).toBeUndefined();
  });

  it('splits on first colon for qualified ID', () => {
    expect(parseQualifiedId('canopy:ui-lib')).toEqual({ repo: 'canopy', planId: 'ui-lib' });
  });

  it('handles multiple colons (splits on first)', () => {
    expect(parseQualifiedId('canopy:sub/dir:plan')).toEqual({ repo: 'canopy', planId: 'sub/dir:plan' });
  });

  it('handles empty segments', () => {
    expect(parseQualifiedId(':plan')).toEqual({ repo: '', planId: 'plan' });
    expect(parseQualifiedId('repo:')).toEqual({ repo: 'repo', planId: '' });
  });
});

// =============================================
// mergeWithRemote
// =============================================

describe('mergeWithRemote', () => {
  it('keeps local plans with unqualified IDs', () => {
    const local = [makePlan('auth')];
    const remote: Plan[] = [];
    const merged = mergeWithRemote(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('auth');
  });

  it('qualifies remote plan IDs with repo alias', () => {
    const local: Plan[] = [];
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy' })];
    const merged = mergeWithRemote(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('canopy:ui-lib');
  });

  it('qualifies intra-repo deps within remote plans', () => {
    const local: Plan[] = [];
    const remote = [
      makePlan('ui-lib', { repoAlias: 'canopy', depends_on: ['core-utils'] }),
    ];
    const merged = mergeWithRemote(local, remote);
    expect(merged[0].frontmatter.depends_on).toEqual(['canopy:core-utils']);
  });

  it('preserves already-qualified cross-repo deps', () => {
    const local: Plan[] = [];
    const remote = [
      makePlan('ui-lib', { repoAlias: 'canopy', depends_on: ['trellis:plan-schema'] }),
    ];
    const merged = mergeWithRemote(local, remote);
    expect(merged[0].frontmatter.depends_on).toEqual(['trellis:plan-schema']);
  });

  it('strips local alias from remote-to-local deps', () => {
    const local = [makePlan('auth')];
    const remote = [
      makePlan('core-utils', { repoAlias: 'canopy', depends_on: ['trellis:auth'] }),
    ];
    const merged = mergeWithRemote(local, remote, 'trellis');
    // 'trellis:auth' should be stripped to 'auth' since trellis is the local project
    expect(merged[1].frontmatter.depends_on).toEqual(['auth']);
  });

  it('strips local alias but qualifies other deps in same plan', () => {
    const local = [makePlan('auth')];
    const remote = [
      makePlan('core-utils', { repoAlias: 'canopy', depends_on: ['trellis:auth', 'other-canopy-plan'] }),
    ];
    const merged = mergeWithRemote(local, remote, 'trellis');
    expect(merged[1].frontmatter.depends_on).toEqual(['auth', 'canopy:other-canopy-plan']);
  });

  it('preserves cross-repo deps to third-party repos when local alias set', () => {
    const local: Plan[] = [];
    const remote = [
      makePlan('ui-lib', { repoAlias: 'canopy', depends_on: ['grove:some-plan'] }),
    ];
    const merged = mergeWithRemote(local, remote, 'trellis');
    expect(merged[0].frontmatter.depends_on).toEqual(['grove:some-plan']);
  });

  it('combines local and remote plans', () => {
    const local = [makePlan('auth')];
    const remote = [
      makePlan('ui-lib', { repoAlias: 'canopy' }),
      makePlan('core-utils', { repoAlias: 'canopy' }),
    ];
    const merged = mergeWithRemote(local, remote);
    expect(merged).toHaveLength(3);
    expect(merged.map(p => p.id)).toEqual(['auth', 'canopy:ui-lib', 'canopy:core-utils']);
  });

  it('does not modify original remote plan objects', () => {
    const remotePlan = makePlan('ui-lib', { repoAlias: 'canopy', depends_on: ['core-utils'] });
    const originalId = remotePlan.id;
    mergeWithRemote([], [remotePlan]);
    expect(remotePlan.id).toBe(originalId); // original unchanged
  });
});

// =============================================
// Graph construction with qualified IDs
// =============================================

describe('buildGraph with cross-repo plans', () => {
  it('resolves cross-repo deps in the unified graph', () => {
    const local = [makePlan('auth', { depends_on: ['canopy:ui-lib'] })];
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy', status: 'done' })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    expect(graph.dependencies.get('auth')).toEqual(['canopy:ui-lib']);
    expect(graph.dependents.get('canopy:ui-lib')).toEqual(['auth']);
  });

  it('marks plan as ready when cross-repo dep is done', () => {
    const local = [makePlan('auth', { depends_on: ['canopy:ui-lib'] })];
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy', status: 'done' })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    expect(graph.ready.has('auth')).toBe(true);
    expect(graph.blocked.has('auth')).toBe(false);
  });

  it('marks plan as blocked when cross-repo dep is not done', () => {
    const local = [makePlan('auth', { depends_on: ['canopy:ui-lib'] })];
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy', status: 'in_progress' })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    expect(graph.blocked.has('auth')).toBe(true);
    expect(graph.ready.has('auth')).toBe(false);
  });

  it('handles remote-to-remote deps correctly', () => {
    const local: Plan[] = [];
    const remote = [
      makePlan('ui-lib', { repoAlias: 'canopy', depends_on: ['core-utils'], status: 'not_started' }),
      makePlan('core-utils', { repoAlias: 'canopy', status: 'done' }),
    ];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    expect(graph.dependencies.get('canopy:ui-lib')).toEqual(['canopy:core-utils']);
    expect(graph.ready.has('canopy:ui-lib')).toBe(true);
  });

  it('pickNext works with cross-repo graph', () => {
    const local = [
      makePlan('a', { depends_on: ['canopy:blocker'] }),
      makePlan('b'),
    ];
    const remote = [makePlan('blocker', { repoAlias: 'canopy', status: 'in_progress' })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    // Only 'b' is ready (local), 'a' is blocked
    const next = pickNext(graph);
    expect(next).toBe('b');
  });

  it('newlyReady detects cross-repo unblocking', () => {
    const local = [makePlan('auth', { depends_on: ['canopy:ui-lib'] })];
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy', status: 'in_progress' })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    // Simulate canopy:ui-lib becoming done
    const ready = newlyReady('canopy:ui-lib', 'done', graph);
    expect(ready).toEqual(['auth']);
  });

  it('computeCriticalPath includes cross-repo deps', () => {
    const local = [makePlan('auth', { depends_on: ['canopy:ui-lib'] })];
    const remote = [
      makePlan('ui-lib', { repoAlias: 'canopy', depends_on: ['core-utils'], status: 'not_started' }),
      makePlan('core-utils', { repoAlias: 'canopy', status: 'done' }),
    ];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    const path = computeCriticalPath('auth', graph);
    expect(path).toEqual(['canopy:core-utils', 'canopy:ui-lib', 'auth']);
  });

  it('resolves remote-to-local deps when local alias provided', () => {
    const local = [makePlan('auth', { status: 'done' })];
    const remote = [
      makePlan('core-utils', { repoAlias: 'canopy', depends_on: ['trellis:auth'], status: 'not_started' }),
    ];
    const merged = mergeWithRemote(local, remote, 'trellis');
    const graph = buildGraph(merged);

    // canopy:core-utils should depend on local 'auth' (not 'trellis:auth')
    expect(graph.dependencies.get('canopy:core-utils')).toEqual(['auth']);
    expect(graph.dependents.get('auth')).toEqual(['canopy:core-utils']);
    // auth is done, so canopy:core-utils should be ready
    expect(graph.ready.has('canopy:core-utils')).toBe(true);
  });

  it('remote-to-local dep does not create dangling edges', () => {
    const local = [makePlan('auth', { status: 'in_progress' })];
    const remote = [
      makePlan('core-utils', { repoAlias: 'canopy', depends_on: ['trellis:auth'], status: 'not_started' }),
    ];
    const merged = mergeWithRemote(local, remote, 'trellis');
    const graph = buildGraph(merged);

    // The dep should resolve — no missing dep
    const allPlanIds = new Set(merged.map(p => p.id));
    for (const dep of merged[1].frontmatter.depends_on ?? []) {
      expect(allPlanIds.has(dep)).toBe(true);
    }
    // auth is not done, so canopy:core-utils should be blocked
    expect(graph.blocked.has('canopy:core-utils')).toBe(true);
  });
});

// =============================================
// Write operation guards
// =============================================

describe('write operation guards', () => {
  it('computeUpdate rejects remote plans', () => {
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy', status: 'not_started' })];
    const merged = mergeWithRemote([], remote);
    const graph = buildGraph(merged);

    expect(() =>
      computeUpdate(
        { planId: 'canopy:ui-lib', status: 'in_progress', graph, force: true },
      )
    ).toThrow("Cannot modify remote plan 'canopy:ui-lib'. Write operations are local only.");
  });

  it('computeSet rejects remote plans', () => {
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy' })];
    const merged = mergeWithRemote([], remote);
    const graph = buildGraph(merged);

    expect(() =>
      computeSet(
        { planId: 'canopy:ui-lib', field: 'title', value: 'New', mode: 'replace', graph },
      )
    ).toThrow("Cannot modify remote plan 'canopy:ui-lib'. Write operations are local only.");
  });

  it('computeWriteSection rejects remote plans', () => {
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy' })];
    const merged = mergeWithRemote([], remote);
    const graph = buildGraph(merged);

    expect(() =>
      computeWriteSection(
        { planId: 'canopy:ui-lib', file: 'readme', section: 'Problem', content: 'test', graph },
      )
    ).toThrow("Cannot modify remote plan 'canopy:ui-lib'. Write operations are local only.");
  });

  it('computeWriteSections rejects remote plans', () => {
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy' })];
    const merged = mergeWithRemote([], remote);
    const graph = buildGraph(merged);

    expect(() =>
      computeWriteSections(
        { planId: 'canopy:ui-lib', writes: [{ file: 'readme', section: 'Problem', content: 'test' }], graph },
      )
    ).toThrow("Cannot modify remote plan 'canopy:ui-lib'. Write operations are local only.");
  });

  it('computeRename rejects remote plans', () => {
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy' })];
    const merged = mergeWithRemote([], remote);
    const graph = buildGraph(merged);

    expect(() =>
      computeRename(
        { oldId: 'canopy:ui-lib', newId: 'new-name', plansDir: '/tmp', graph },
        { refresh: () => {} },
      )
    ).toThrow("Cannot modify remote plan 'canopy:ui-lib'. Write operations are local only.");
  });

  it('computeArchive rejects remote plans', () => {
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy' })];
    const merged = mergeWithRemote([], remote);
    const graph = buildGraph(merged);

    expect(() =>
      computeArchive(
        { planId: 'canopy:ui-lib', graph },
        { refresh: () => {} },
      )
    ).toThrow("Cannot modify remote plan 'canopy:ui-lib'. Write operations are local only.");
  });

  it('computeReadSection returns body for remote plans', () => {
    const remote = [
      { ...makePlan('ui-lib', { repoAlias: 'canopy' }), body: 'Some plan content' },
    ];
    const merged = mergeWithRemote([], remote);
    const graph = buildGraph(merged);

    const result = computeReadSection({ planId: 'canopy:ui-lib', graph });
    expect(result.content).toBe('Some plan content');
  });

  it('computeReadSection throws when requesting files from remote plans', () => {
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy' })];
    const merged = mergeWithRemote([], remote);
    const graph = buildGraph(merged);

    expect(() =>
      computeReadSection({ planId: 'canopy:ui-lib', file: 'readme', graph })
    ).toThrow("Cannot read files from remote plan 'canopy:ui-lib'");
  });
});

// =============================================
// Ready: cross-repo blocking
// =============================================

describe('computeReady with cross-repo', () => {
  it('excludes plans blocked by cross-repo deps', () => {
    const local = [
      makePlan('a', { depends_on: ['canopy:blocker'] }),
      makePlan('b'),
    ];
    const remote = [makePlan('blocker', { repoAlias: 'canopy', status: 'in_progress' })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    const result = computeReady({ plans: merged, graph });
    expect(result.plans.map(p => p.id)).toEqual(['b']);
  });

  it('includes plans when cross-repo deps are done', () => {
    const local = [
      makePlan('a', { depends_on: ['canopy:blocker'] }),
    ];
    const remote = [makePlan('blocker', { repoAlias: 'canopy', status: 'done' })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    const result = computeReady({ plans: merged, graph });
    expect(result.plans.map(p => p.id)).toEqual(['a']);
  });

  it('does not show remote plans in ready list', () => {
    const local: Plan[] = [];
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy' })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    const result = computeReady({ plans: merged, graph });
    expect(result.plans).toEqual([]);
  });
});

// =============================================
// Show: qualified ID resolution
// =============================================

describe('computeShow with cross-repo', () => {
  it('resolves qualified IDs', () => {
    const local: Plan[] = [];
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy', status: 'in_progress' })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    const result = computeShow({ planId: 'canopy:ui-lib', graph });
    expect(result).not.toBeNull();
    expect(result!.id).toBe('canopy:ui-lib');
    expect(result!.title).toBe('Plan ui-lib');
  });

  it('shows cross-repo deps with correct status', () => {
    const local = [makePlan('auth', { depends_on: ['canopy:ui-lib'] })];
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy', status: 'in_progress' })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    const result = computeShow({ planId: 'auth', graph });
    expect(result!.dependsOn).toEqual([
      { id: 'canopy:ui-lib', status: 'in_progress', satisfied: false },
    ]);
    expect(result!.blocked).toBe(true);
  });
});

// =============================================
// Status: cross-repo blockers
// =============================================

describe('computeStatus with cross-repo', () => {
  it('shows cross-repo blockers as qualified IDs', () => {
    const local = [makePlan('auth', { depends_on: ['canopy:ui-lib'] })];
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy', status: 'in_progress' })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    const result = computeStatus({
      plans: merged,
      config: { project: 'test', plans_dir: 'plans' },
      graph,
    });

    expect(result.byStatus.blocked).toHaveLength(1);
    expect(result.byStatus.blocked[0].waitingOn).toEqual(['canopy:ui-lib']);
  });

  it('excludes remote plans from status output', () => {
    const local = [makePlan('auth')];
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy' })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    const result = computeStatus({
      plans: merged,
      config: { project: 'test', plans_dir: 'plans' },
      graph,
    });

    const allIds = [
      ...result.byStatus.ready,
      ...result.byStatus.blocked,
      ...result.byStatus.inProgress,
      ...result.byStatus.draft,
      ...result.byStatus.done,
      ...result.byStatus.archived,
    ].map(p => p.id);

    expect(allIds).not.toContain('canopy:ui-lib');
    expect(allIds).toContain('auth');
  });
});

// =============================================
// Lint: cross-repo validation
// =============================================

describe('computeLint with cross-repo', () => {
  it('warns when cross-repo dep has no outputs', () => {
    const remote = [makePlan('ui-lib', { repoAlias: 'canopy', status: 'done' })];
    const { root, plansDir } = createFixture([
      { id: 'auth', title: 'Auth', status: 'not_started', depends_on: ['canopy:ui-lib'] },
    ]);
    const local = [makePlan('auth', { depends_on: ['canopy:ui-lib'] })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    const result = computeLint({
      plans: merged,
      graph,
      projectDir: root,
      plansDir,
    });

    const crossRepoWarnings = result.warnings.filter(w => w.type === 'cross_repo_no_outputs');
    expect(crossRepoWarnings).toHaveLength(1);
    expect(crossRepoWarnings[0].message).toContain('canopy:ui-lib');
  });

  it('does not warn when cross-repo dep has outputs', () => {
    const remotePlan = makePlan('ui-lib', { repoAlias: 'canopy', status: 'done' });
    (remotePlan as any).outputs = { raw: '', fromPlans: [], fromCode: [], sections: [{ heading: 'API', items: [] }] };
    const remote = [remotePlan];

    const local = [makePlan('auth', { depends_on: ['canopy:ui-lib'] })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    const { root, plansDir } = createFixture([]);
    const result = computeLint({
      plans: merged,
      graph,
      projectDir: root,
      plansDir,
    });

    const crossRepoWarnings = result.warnings.filter(w => w.type === 'cross_repo_no_outputs');
    expect(crossRepoWarnings).toHaveLength(0);
  });

  it('runs checkVisibility when manifest is provided', () => {
    const manifest: ProjectManifest = {
      name: 'test-project',
      repos: {
        public_repo: { url: 'x', branch: 'main', visibility: 'public' },
        private_repo: { url: 'y', branch: 'main', visibility: 'private' },
      },
    };

    const local = [makePlan('pub-plan', { depends_on: ['private_repo:priv-plan'] })];
    const remote = [makePlan('priv-plan', { repoAlias: 'private_repo', status: 'done' })];
    const merged = mergeWithRemote(local, remote);
    const graph = buildGraph(merged);

    const { root, plansDir } = createFixture([]);
    const result = computeLint({
      plans: merged,
      graph,
      projectDir: root,
      plansDir,
      manifest,
      projectName: 'public_repo', // local project is the public repo
    });

    const visibilityErrors = result.errors.filter(e => e.type === 'visibility');
    expect(visibilityErrors.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================
// Backward compatibility
// =============================================

describe('backward compatibility (no manifest)', () => {
  it('createContext works without manifest', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);

    const ctx = createContext(root);
    expect(ctx.plans).toHaveLength(1);
    expect(ctx.plans[0].id).toBe('a');
    expect(ctx.manifest).toBeUndefined();
  });

  it('refreshContext works without manifest', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);

    const ctx = createContext(root);
    const refreshed = refreshContext(ctx);
    expect(refreshed.plans).toHaveLength(1);
    expect(refreshed.manifest).toBeUndefined();
  });

  it('computeLint works without manifest', () => {
    const { root, plansDir } = createFixture([
      { id: 'a', title: 'Plan A', status: 'draft' },
    ]);

    const ctx = createContext(root);
    const result = computeLint({
      plans: ctx.plans,
      graph: ctx.graph,
      projectDir: root,
      plansDir,
    });

    // Should work without errors (no visibility check without manifest)
    expect(result.errors.filter(e => e.type === 'visibility')).toHaveLength(0);
  });
});

// =============================================
// Cache integration
// =============================================

describe('cache integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-cache-'));
    mkdirSync(join(tmpDir, '.trellis', 'cache'), { recursive: true });
  });

  it('writeCache and readCache roundtrip for plans', () => {
    const plans: Plan[] = [makePlan('ui-lib', { repoAlias: 'canopy' })];
    writeCache(tmpDir, 'plans/canopy', plans);

    const cached = readCache<Plan[]>(tmpDir, 'plans/canopy');
    expect(cached).not.toBeNull();
    expect(cached!.data).toHaveLength(1);
    expect(cached!.data[0].id).toBe('ui-lib');
  });

  it('writeCache creates nested directories for plans/<alias>', () => {
    writeCache(tmpDir, 'plans/deep-alias', []);
    expect(existsSync(join(tmpDir, '.trellis', 'cache', 'plans', 'deep-alias.json'))).toBe(true);
  });
});

// =============================================
// --offline flag
// =============================================

describe('--offline flag', () => {
  it('createContext with offline returns local-only when no manifest', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);

    const ctx = createContext(root, { offline: true });
    expect(ctx.plans).toHaveLength(1);
    expect(ctx.plans[0].id).toBe('a');
  });
});
