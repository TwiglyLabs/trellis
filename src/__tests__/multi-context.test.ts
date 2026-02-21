import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createMultiContext } from '../core/context.ts';
import { createFixture } from './helpers.ts';

describe('createMultiContext', () => {
  // --- Basic multi-repo scan ---

  it('scans two repos and returns plans with qualified IDs', () => {
    const repoA = createFixture([
      { id: 'plan-1', title: 'Plan 1', status: 'not_started' },
      { id: 'plan-2', title: 'Plan 2', status: 'draft' },
    ]);
    const repoB = createFixture([
      { id: 'plan-3', title: 'Plan 3', status: 'in_progress' },
      { id: 'plan-4', title: 'Plan 4', status: 'done' },
    ]);

    const result = createMultiContext([
      { path: repoA.root, alias: 'repo-a' },
      { path: repoB.root, alias: 'repo-b' },
    ]);

    const ids = result.plans.map(p => p.id).sort();
    expect(ids).toEqual([
      'repo-a:plan-1',
      'repo-a:plan-2',
      'repo-b:plan-3',
      'repo-b:plan-4',
    ]);
  });

  it('returns repos metadata with correct plan counts', () => {
    const repoA = createFixture([
      { id: 'plan-1', title: 'Plan 1', status: 'not_started' },
      { id: 'plan-2', title: 'Plan 2', status: 'draft' },
    ]);
    const repoB = createFixture([
      { id: 'plan-3', title: 'Plan 3', status: 'in_progress' },
    ]);

    const result = createMultiContext([
      { path: repoA.root, alias: 'repo-a' },
      { path: repoB.root, alias: 'repo-b' },
    ]);

    expect(result.repos).toHaveLength(2);
    expect(result.repos[0]).toMatchObject({
      alias: 'repo-a',
      path: repoA.root,
      planCount: 2,
      configFound: true,
    });
    expect(result.repos[1]).toMatchObject({
      alias: 'repo-b',
      path: repoB.root,
      planCount: 1,
      configFound: true,
    });
  });

  it('sets repoAlias on all plans', () => {
    const repoA = createFixture([
      { id: 'plan-1', title: 'Plan 1', status: 'not_started' },
    ]);

    const result = createMultiContext([
      { path: repoA.root, alias: 'myrepo' },
    ]);

    expect(result.plans[0].repoAlias).toBe('myrepo');
  });

  // --- Cross-repo dependencies ---

  it('resolves cross-repo dependencies in the graph', () => {
    const repoA = createFixture([
      { id: 'consumer', title: 'Consumer', status: 'not_started', depends_on: ['repo-b:provider'] },
    ]);
    const repoB = createFixture([
      { id: 'provider', title: 'Provider', status: 'done' },
    ]);

    const result = createMultiContext([
      { path: repoA.root, alias: 'repo-a' },
      { path: repoB.root, alias: 'repo-b' },
    ]);

    expect(result.graph.dependencies.get('repo-a:consumer')).toEqual(['repo-b:provider']);
    expect(result.graph.dependents.get('repo-b:provider')).toEqual(['repo-a:consumer']);
  });

  it('marks plan as ready when cross-repo dep is done', () => {
    const repoA = createFixture([
      { id: 'consumer', title: 'Consumer', status: 'not_started', depends_on: ['repo-b:provider'] },
    ]);
    const repoB = createFixture([
      { id: 'provider', title: 'Provider', status: 'done' },
    ]);

    const result = createMultiContext([
      { path: repoA.root, alias: 'repo-a' },
      { path: repoB.root, alias: 'repo-b' },
    ]);

    expect(result.graph.ready.has('repo-a:consumer')).toBe(true);
    expect(result.graph.blocked.has('repo-a:consumer')).toBe(false);
  });

  it('marks plan as blocked when cross-repo dep is not done', () => {
    const repoA = createFixture([
      { id: 'consumer', title: 'Consumer', status: 'not_started', depends_on: ['repo-b:provider'] },
    ]);
    const repoB = createFixture([
      { id: 'provider', title: 'Provider', status: 'in_progress' },
    ]);

    const result = createMultiContext([
      { path: repoA.root, alias: 'repo-a' },
      { path: repoB.root, alias: 'repo-b' },
    ]);

    expect(result.graph.blocked.has('repo-a:consumer')).toBe(true);
    expect(result.graph.ready.has('repo-a:consumer')).toBe(false);
  });

  // --- Intra-repo dep qualification ---

  it('qualifies bare intra-repo deps with the repo alias', () => {
    const repoA = createFixture([
      { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['plan-a'] },
      { id: 'plan-a', title: 'Plan A', status: 'done' },
    ]);

    const result = createMultiContext([
      { path: repoA.root, alias: 'myrepo' },
    ]);

    const planB = result.plans.find(p => p.id === 'myrepo:plan-b')!;
    expect(planB.frontmatter.depends_on).toEqual(['myrepo:plan-a']);
  });

  it('preserves already-qualified cross-repo deps', () => {
    const repoA = createFixture([
      { id: 'consumer', title: 'Consumer', status: 'not_started', depends_on: ['other:external'] },
    ]);

    const result = createMultiContext([
      { path: repoA.root, alias: 'myrepo' },
    ]);

    const consumer = result.plans.find(p => p.id === 'myrepo:consumer')!;
    expect(consumer.frontmatter.depends_on).toEqual(['other:external']);
  });

  // --- Missing config ---

  it('skips repos with missing .trellis config gracefully', () => {
    const repoA = createFixture([
      { id: 'plan-1', title: 'Plan 1', status: 'not_started' },
    ]);

    const badDir = mkdtempSync(join(tmpdir(), 'no-trellis-'));

    const result = createMultiContext([
      { path: repoA.root, alias: 'repo-a' },
      { path: badDir, alias: 'repo-b' },
    ]);

    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].id).toBe('repo-a:plan-1');

    expect(result.repos).toHaveLength(2);
    expect(result.repos[1]).toMatchObject({
      alias: 'repo-b',
      configFound: false,
      planCount: 0,
    });
  });

  // --- Duplicate alias ---

  it('throws on duplicate aliases', () => {
    const repoA = createFixture([
      { id: 'plan-1', title: 'Plan 1', status: 'not_started' },
    ]);
    const repoB = createFixture([
      { id: 'plan-2', title: 'Plan 2', status: 'draft' },
    ]);

    expect(() =>
      createMultiContext([
        { path: repoA.root, alias: 'same' },
        { path: repoB.root, alias: 'same' },
      ])
    ).toThrow(/duplicate.*alias/i);
  });

  // --- Empty repo ---

  it('handles repos with valid config but no plans', () => {
    const repoA = createFixture([
      { id: 'plan-1', title: 'Plan 1', status: 'not_started' },
    ]);
    const emptyRepo = createFixture([]);

    const result = createMultiContext([
      { path: repoA.root, alias: 'repo-a' },
      { path: emptyRepo.root, alias: 'repo-b' },
    ]);

    expect(result.plans).toHaveLength(1);
    expect(result.repos[1]).toMatchObject({
      alias: 'repo-b',
      planCount: 0,
      configFound: true,
    });
  });

  // --- Single repo ---

  it('works with a single repo', () => {
    const repoA = createFixture([
      { id: 'plan-1', title: 'Plan 1', status: 'not_started' },
      { id: 'plan-2', title: 'Plan 2', status: 'draft' },
    ]);

    const result = createMultiContext([
      { path: repoA.root, alias: 'solo' },
    ]);

    expect(result.plans).toHaveLength(2);
    expect(result.plans.map(p => p.id).sort()).toEqual(['solo:plan-1', 'solo:plan-2']);
    expect(result.repos).toHaveLength(1);
  });

  // --- Graph correctness ---

  it('builds a correct unified graph across repos', () => {
    const repoA = createFixture([
      { id: 'a1', title: 'A1', status: 'done' },
      { id: 'a2', title: 'A2', status: 'not_started', depends_on: ['a1'] },
    ]);
    const repoB = createFixture([
      { id: 'b1', title: 'B1', status: 'not_started', depends_on: ['repo-a:a1'] },
      { id: 'b2', title: 'B2', status: 'not_started', depends_on: ['b1'] },
    ]);

    const result = createMultiContext([
      { path: repoA.root, alias: 'repo-a' },
      { path: repoB.root, alias: 'repo-b' },
    ]);

    // Check graph has all 4 plans
    expect(result.graph.plans.size).toBe(4);

    // Intra-repo dep: a2 depends on a1
    expect(result.graph.dependencies.get('repo-a:a2')).toEqual(['repo-a:a1']);

    // Cross-repo dep: b1 depends on a1
    expect(result.graph.dependencies.get('repo-b:b1')).toEqual(['repo-a:a1']);

    // Chained intra-repo: b2 depends on b1
    expect(result.graph.dependencies.get('repo-b:b2')).toEqual(['repo-b:b1']);

    // a1 is done, so a2 and b1 should be ready
    expect(result.graph.ready.has('repo-a:a2')).toBe(true);
    expect(result.graph.ready.has('repo-b:b1')).toBe(true);

    // b2 is blocked by b1 which is not done
    expect(result.graph.blocked.has('repo-b:b2')).toBe(true);
  });

  it('returns empty results for empty repos array', () => {
    const result = createMultiContext([]);

    expect(result.plans).toEqual([]);
    expect(result.repos).toEqual([]);
    expect(result.graph.plans.size).toBe(0);
  });

  it('preserves original filePath on qualified plans', () => {
    const repoA = createFixture([
      { id: 'plan-1', title: 'Plan 1', status: 'not_started' },
    ]);

    const result = createMultiContext([
      { path: repoA.root, alias: 'repo-a' },
    ]);

    expect(result.plans[0].id).toBe('repo-a:plan-1');
    expect(result.plans[0].filePath).toContain(repoA.root);
    expect(result.plans[0].filePath).toContain('plan-1/README.md');
  });

  it('returns a valid context shape', () => {
    const repoA = createFixture([
      { id: 'plan-1', title: 'Plan 1', status: 'not_started' },
    ]);

    const result = createMultiContext([
      { path: repoA.root, alias: 'repo-a' },
    ]);

    // Should have TrellisContext fields
    expect(result.plans).toBeDefined();
    expect(result.graph).toBeDefined();
    expect(result.graph.plans).toBeDefined();
    expect(result.graph.ready).toBeDefined();
    expect(result.graph.blocked).toBeDefined();
    expect(result.graph.dependencies).toBeDefined();
    expect(result.graph.dependents).toBeDefined();

    // Plus multi-context fields
    expect(result.repos).toBeDefined();
  });
});
