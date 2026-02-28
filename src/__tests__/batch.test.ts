import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ContextStore } from '../core/store.ts';
import { computeCreateBatch, topologicalSort } from '../features/create/batch.ts';
import { createFixture, type FixturePlan } from './helpers.ts';

// =============================================
// Test fixture helper
// =============================================

function createBatchFixture(repoFixtures: Array<{ alias: string; plans: FixturePlan[] }>): {
  store: ContextStore;
  repos: Array<{ alias: string; root: string; plansDir: string }>;
} {
  const repos = [];
  for (const rf of repoFixtures) {
    const { root, plansDir } = createFixture(rf.plans);
    repos.push({ alias: rf.alias, root, plansDir });
  }

  const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-batch-test-'));
  const store = new ContextStore({
    repos: repos.map(r => ({ path: r.root, alias: r.alias })),
    cacheDir,
    qualifyIds: true,
  });
  store.load();

  return { store, repos };
}

// =============================================
// topologicalSort
// =============================================

describe('topologicalSort', () => {
  it('sorts plans with no deps (all roots)', () => {
    const sorted = topologicalSort([
      { id: 'repo:b', title: 'B' },
      { id: 'repo:a', title: 'A' },
    ]);
    // Both are roots — order is stable (b first, then a)
    expect(sorted).toHaveLength(2);
  });

  it('sorts deps before dependents', () => {
    const sorted = topologicalSort([
      { id: 'repo:child', title: 'Child', depends_on: ['repo:parent'] },
      { id: 'repo:parent', title: 'Parent' },
    ]);
    expect(sorted[0].id).toBe('repo:parent');
    expect(sorted[1].id).toBe('repo:child');
  });

  it('handles chain of deps', () => {
    const sorted = topologicalSort([
      { id: 'r:c', title: 'C', depends_on: ['r:b'] },
      { id: 'r:a', title: 'A' },
      { id: 'r:b', title: 'B', depends_on: ['r:a'] },
    ]);
    expect(sorted[0].id).toBe('r:a');
    expect(sorted[1].id).toBe('r:b');
    expect(sorted[2].id).toBe('r:c');
  });

  it('ignores deps outside the batch', () => {
    const sorted = topologicalSort([
      { id: 'r:plan', title: 'Plan', depends_on: ['r:external'] },
    ]);
    // external is not in the batch, so plan has no in-batch deps → comes first
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe('r:plan');
  });

  it('detects simple cycle', () => {
    expect(() => topologicalSort([
      { id: 'r:a', title: 'A', depends_on: ['r:b'] },
      { id: 'r:b', title: 'B', depends_on: ['r:a'] },
    ])).toThrow(/cycle/i);
  });

  it('detects 3-node cycle', () => {
    expect(() => topologicalSort([
      { id: 'r:a', title: 'A', depends_on: ['r:c'] },
      { id: 'r:b', title: 'B', depends_on: ['r:a'] },
      { id: 'r:c', title: 'C', depends_on: ['r:b'] },
    ])).toThrow(/cycle/i);
  });

  it('handles empty array', () => {
    const sorted = topologicalSort([]);
    expect(sorted).toHaveLength(0);
  });

  it('handles single plan', () => {
    const sorted = topologicalSort([{ id: 'r:solo', title: 'Solo' }]);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe('r:solo');
  });
});

// =============================================
// computeCreateBatch
// =============================================

describe('computeCreateBatch', () => {
  it('creates plans in topological order', () => {
    const { store, repos } = createBatchFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    const result = computeCreateBatch({
      plans: [
        { id: 'repo-a:plan-b', title: 'Plan B', depends_on: ['repo-a:plan-a'] },
        { id: 'repo-a:plan-a', title: 'Plan A' },
      ],
      store,
    });

    expect(result.created).toHaveLength(2);
    expect(result.created[0].id).toBe('repo-a:plan-a');
    expect(result.created[1].id).toBe('repo-a:plan-b');

    // Verify files exist
    expect(existsSync(join(repos[0].plansDir, 'plan-a', 'README.md'))).toBe(true);
    expect(existsSync(join(repos[0].plansDir, 'plan-b', 'README.md'))).toBe(true);
  });

  it('validates deps against union of existing + batch', () => {
    const { store } = createBatchFixture([
      { alias: 'repo-a', plans: [{ id: 'existing', title: 'Existing', status: 'draft' }] },
    ]);

    const result = computeCreateBatch({
      plans: [
        { id: 'repo-a:new-plan', title: 'New', depends_on: ['repo-a:existing'] },
      ],
      store,
    });

    expect(result.created).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('validates deps against batch plans not yet created', () => {
    const { store } = createBatchFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    // plan-b depends on plan-a, both in batch — should work
    const result = computeCreateBatch({
      plans: [
        { id: 'repo-a:plan-a', title: 'A' },
        { id: 'repo-a:plan-b', title: 'B', depends_on: ['repo-a:plan-a'] },
      ],
      store,
    });

    expect(result.created).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('detects cycles in batch', () => {
    const { store } = createBatchFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    expect(() => computeCreateBatch({
      plans: [
        { id: 'repo-a:a', title: 'A', depends_on: ['repo-a:b'] },
        { id: 'repo-a:b', title: 'B', depends_on: ['repo-a:a'] },
      ],
      store,
    })).toThrow(/cycle/i);
  });

  it('errors on dep not in universe', () => {
    const { store } = createBatchFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    expect(() => computeCreateBatch({
      plans: [
        { id: 'repo-a:plan', title: 'Plan', depends_on: ['repo-a:nonexistent'] },
      ],
      store,
    })).toThrow(/not found/);
  });

  it('skips plans that already exist', () => {
    const { store } = createBatchFixture([
      { alias: 'repo-a', plans: [{ id: 'existing', title: 'Existing', status: 'draft' }] },
    ]);

    const result = computeCreateBatch({
      plans: [
        { id: 'repo-a:existing', title: 'Existing' },
        { id: 'repo-a:new-plan', title: 'New' },
      ],
      store,
    });

    expect(result.created).toHaveLength(1);
    expect(result.created[0].id).toBe('repo-a:new-plan');
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].id).toBe('repo-a:existing');
    expect(result.skipped[0].reason).toBe('already exists');
  });

  it('supports dry-run mode', () => {
    const { store, repos } = createBatchFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    const result = computeCreateBatch({
      plans: [
        { id: 'repo-a:plan-a', title: 'A' },
      ],
      store,
      dryRun: true,
    });

    expect(result.created).toHaveLength(0);
    expect(result.wouldCreate).toHaveLength(1);
    expect(result.wouldCreate![0].id).toBe('repo-a:plan-a');
    // Verify no files written
    expect(existsSync(join(repos[0].plansDir, 'plan-a'))).toBe(false);
  });

  it('creates plans across multiple repos', () => {
    const { store, repos } = createBatchFixture([
      { alias: 'repo-a', plans: [] },
      { alias: 'repo-b', plans: [] },
    ]);

    const result = computeCreateBatch({
      plans: [
        { id: 'repo-a:plan-a', title: 'Plan A' },
        { id: 'repo-b:plan-b', title: 'Plan B', depends_on: ['repo-a:plan-a'] },
      ],
      store,
    });

    expect(result.created).toHaveLength(2);
    expect(existsSync(join(repos[0].plansDir, 'plan-a', 'README.md'))).toBe(true);
    expect(existsSync(join(repos[1].plansDir, 'plan-b', 'README.md'))).toBe(true);
  });

  it('dequalifies same-repo deps on disk', () => {
    const { store, repos } = createBatchFixture([
      { alias: 'repo-a', plans: [] },
      { alias: 'repo-b', plans: [] },
    ]);

    computeCreateBatch({
      plans: [
        { id: 'repo-a:plan-a', title: 'Plan A' },
        { id: 'repo-a:plan-b', title: 'Plan B', depends_on: ['repo-a:plan-a', 'repo-b:plan-c'] },
        { id: 'repo-b:plan-c', title: 'Plan C' },
      ],
      store,
    });

    // Read plan-b's README and check deps
    const { readFileSync } = require('fs');
    const readme = readFileSync(join(repos[0].plansDir, 'plan-b', 'README.md'), 'utf8');
    // Same-repo dep should be dequalified
    expect(readme).toContain('- plan-a');
    expect(readme).not.toMatch(/repo-a:plan-a/);
    // Cross-repo dep should be preserved
    expect(readme).toMatch(/repo-b:plan-c/);
  });

  it('errors on unqualified plan ID', () => {
    const { store } = createBatchFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    expect(() => computeCreateBatch({
      plans: [
        { id: 'bare-plan', title: 'Bare' },
      ],
      store,
    })).toThrow(/qualified/);
  });

  it('errors on unknown repo alias', () => {
    const { store } = createBatchFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    expect(() => computeCreateBatch({
      plans: [
        { id: 'unknown:plan', title: 'Plan' },
      ],
      store,
    })).toThrow(/not found in manifest/);
  });

  it('handles empty plans array', () => {
    const { store } = createBatchFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    const result = computeCreateBatch({ plans: [], store });
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles all plans already exist', () => {
    const { store } = createBatchFixture([
      { alias: 'repo-a', plans: [
        { id: 'plan-1', title: 'Plan 1', status: 'draft' },
        { id: 'plan-2', title: 'Plan 2', status: 'draft' },
      ] },
    ]);

    const result = computeCreateBatch({
      plans: [
        { id: 'repo-a:plan-1', title: 'Plan 1' },
        { id: 'repo-a:plan-2', title: 'Plan 2' },
      ],
      store,
    });

    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('persists successfully created plans when a later plan fails', () => {
    const { store, repos } = createBatchFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    // Create plan-a first so plan-b will fail with "already exists" when created twice
    // We simulate failure by having a plan with no title (computeCreate will throw)
    const result = computeCreateBatch({
      plans: [
        { id: 'repo-a:good-plan', title: 'Good Plan' },
        { id: 'repo-a:bad-plan', title: '' },  // empty title → "title is required"
      ],
      store,
    });

    // good-plan should have been created successfully
    expect(result.created).toHaveLength(1);
    expect(result.created[0].id).toBe('repo-a:good-plan');
    expect(existsSync(join(repos[0].plansDir, 'good-plan', 'README.md'))).toBe(true);

    // bad-plan should be in errors
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('repo-a:bad-plan');
  });

  it('validates all repo aliases upfront before creating anything', () => {
    const { store, repos } = createBatchFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    // First plan is valid, second targets unknown repo — should throw before creating first
    expect(() => computeCreateBatch({
      plans: [
        { id: 'repo-a:valid-plan', title: 'Valid' },
        { id: 'nonexistent:plan', title: 'Bad' },
      ],
      store,
    })).toThrow(/not found in manifest/);

    // First plan should NOT have been created (validation is upfront)
    expect(existsSync(join(repos[0].plansDir, 'valid-plan'))).toBe(false);
  });

  it('validates all IDs are qualified upfront before creating anything', () => {
    const { store, repos } = createBatchFixture([
      { alias: 'repo-a', plans: [] },
    ]);

    expect(() => computeCreateBatch({
      plans: [
        { id: 'repo-a:valid-plan', title: 'Valid' },
        { id: 'bare-plan', title: 'Bare' },
      ],
      store,
    })).toThrow(/qualified/);

    // First plan should NOT have been created
    expect(existsSync(join(repos[0].plansDir, 'valid-plan'))).toBe(false);
  });
});
