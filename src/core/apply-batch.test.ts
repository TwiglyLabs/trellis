import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createContext, applyBatch } from './context.ts';
import { createFixture } from '../__tests__/helpers.ts';
import type { PlanChangeBatch, PlanChangeEvent } from '../features/watch/types.ts';
import type { Plan } from './types.ts';

function makePlan(id: string, status: string, depends_on: string[] = [], body = ''): Plan {
  return {
    id,
    filePath: `plans/${id}/README.md`,
    frontmatter: {
      title: id,
      status: status as any,
      depends_on: depends_on.length > 0 ? depends_on : undefined,
    },
    body,
    lineCount: body.split('\n').length + 4,
    updatedAt: new Date(),
    fileHashes: {},
  };
}

function makeBatch(events: PlanChangeEvent[]): PlanChangeBatch {
  return { events, timestamp: new Date() };
}

describe('applyBatch', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('returns same context for empty batch', () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);
    root = fixture.root;

    const ctx = createContext(root);
    const result = applyBatch(ctx, makeBatch([]));
    expect(result).toBe(ctx);
  });

  it('applies plan-updated event and updates graph', () => {
    const fixture = createFixture([
      { id: 'dep', title: 'Dep', status: 'not_started' },
      { id: 'child', title: 'Child', status: 'not_started', depends_on: ['dep'] },
    ]);
    root = fixture.root;

    const ctx = createContext(root);
    expect(ctx.graph.blocked.has('child')).toBe(true);

    // Simulate dep becoming done
    const updatedDep = makePlan('dep', 'done');
    const result = applyBatch(ctx, makeBatch([
      { type: 'plan-updated', planId: 'dep', file: 'readme', plan: updatedDep },
    ]));

    expect(result.graph.ready.has('child')).toBe(true);
    expect(result.graph.blocked.has('child')).toBe(false);
  });

  it('applies plan-added event', () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
    ]);
    root = fixture.root;

    const ctx = createContext(root);
    expect(ctx.plans).toHaveLength(1);

    const newPlan = makePlan('b', 'not_started', ['a']);
    const result = applyBatch(ctx, makeBatch([
      { type: 'plan-added', planId: 'b', plan: newPlan },
    ]));

    expect(result.plans).toHaveLength(2);
    expect(result.graph.plans.has('b')).toBe(true);
    expect(result.graph.ready.has('b')).toBe(true);
  });

  it('applies plan-removed event', () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started' },
    ]);
    root = fixture.root;

    const ctx = createContext(root);
    expect(ctx.plans).toHaveLength(2);

    const result = applyBatch(ctx, makeBatch([
      { type: 'plan-removed', planId: 'b' },
    ]));

    expect(result.plans).toHaveLength(1);
    expect(result.graph.plans.has('b')).toBe(false);
  });

  it('attaches completeness to added plans', () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
    ]);
    root = fixture.root;

    const ctx = createContext(root);

    const newPlan = makePlan('b', 'not_started', [], '## Problem\n\nThis is a detailed problem statement with enough words to score well in completeness checks.\n\n## Approach\n\nWe will take a systematic approach to solving this problem with multiple phases and careful testing.');
    const result = applyBatch(ctx, makeBatch([
      { type: 'plan-added', planId: 'b', plan: newPlan },
    ]));

    const addedPlan = result.graph.plans.get('b')!;
    expect(addedPlan.completeness).toBeDefined();
    expect(addedPlan.completeness!.aggregate).toBeGreaterThanOrEqual(0);
    expect(addedPlan.completeness!.sections).toBeDefined();
  });

  it('attaches completeness to updated plans', () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', body: '## Problem\n\nOriginal problem text.' },
    ]);
    root = fixture.root;

    const ctx = createContext(root);

    const updatedA = makePlan('a', 'not_started', [], '## Problem\n\nUpdated problem with much more detailed content so it scores higher on the completeness scale.');
    const result = applyBatch(ctx, makeBatch([
      { type: 'plan-updated', planId: 'a', file: 'readme', plan: updatedA },
    ]));

    const plan = result.graph.plans.get('a')!;
    expect(plan.completeness).toBeDefined();
  });

  it('preserves config and projectDir from original context', () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);
    root = fixture.root;

    const ctx = createContext(root);
    const updatedA = makePlan('a', 'done');
    const result = applyBatch(ctx, makeBatch([
      { type: 'plan-updated', planId: 'a', file: 'readme', plan: updatedA },
    ]));

    expect(result.projectDir).toBe(ctx.projectDir);
    expect(result.config).toBe(ctx.config);
    expect(result.plansDir).toBe(ctx.plansDir);
  });

  it('keeps plans array in sync with graph.plans map', () => {
    const fixture = createFixture([
      { id: 'a', title: 'A', status: 'not_started' },
      { id: 'b', title: 'B', status: 'not_started' },
    ]);
    root = fixture.root;

    const ctx = createContext(root);

    // Add one, remove one
    const newPlan = makePlan('c', 'draft');
    const result = applyBatch(ctx, makeBatch([
      { type: 'plan-removed', planId: 'a' },
      { type: 'plan-added', planId: 'c', plan: newPlan },
    ]));

    expect(result.plans).toHaveLength(2);
    const ids = result.plans.map(p => p.id).sort();
    expect(ids).toEqual(['b', 'c']);
    expect(result.graph.plans.size).toBe(2);
  });
});
