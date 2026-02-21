import { describe, it, expect } from 'vitest';
import { padRight, pluralize, computeColumnWidth, filterPlans } from './utils.ts';
import type { Plan } from './types.ts';

function makePlan(id: string, opts: { tags?: string[]; repo?: string } = {}): Plan {
  return {
    id,
    filePath: `plans/${id}.md`,
    frontmatter: {
      title: id,
      status: 'not_started',
      tags: opts.tags,
      repo: opts.repo,
    },
    body: '',
    lineCount: 1,
    updatedAt: new Date(),
    fileHashes: {},
  };
}

describe('padRight', () => {
  it('pads short strings', () => {
    expect(padRight('abc', 6)).toBe('abc   ');
  });

  it('returns string unchanged when at length', () => {
    expect(padRight('abcdef', 6)).toBe('abcdef');
  });

  it('returns string unchanged when longer', () => {
    expect(padRight('abcdefgh', 6)).toBe('abcdefgh');
  });
});

describe('pluralize', () => {
  it('uses singular for 1', () => {
    expect(pluralize(1, 'plan')).toBe('1 plan');
  });

  it('uses plural for 0', () => {
    expect(pluralize(0, 'plan')).toBe('0 plans');
  });

  it('uses plural for many', () => {
    expect(pluralize(5, 'plan')).toBe('5 plans');
  });

  it('uses custom plural', () => {
    expect(pluralize(2, 'status', 'statuses')).toBe('2 statuses');
  });
});

describe('computeColumnWidth', () => {
  it('returns min for empty list', () => {
    expect(computeColumnWidth([])).toBe(20);
  });

  it('computes width from longest item', () => {
    expect(computeColumnWidth(['short', 'a-much-longer-string'])).toBe(22);
  });

  it('clamps to max', () => {
    expect(computeColumnWidth(['a'.repeat(100)])).toBe(50);
  });

  it('respects custom min and max', () => {
    expect(computeColumnWidth(['hi'], 10, 30)).toBe(10);
  });
});

describe('filterPlans', () => {
  it('filters by tag', () => {
    const plans = [
      makePlan('a', { tags: ['cloud'] }),
      makePlan('b', { tags: ['public'] }),
    ];
    const result = filterPlans(plans, { tag: 'cloud' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('filters by repo', () => {
    const plans = [
      makePlan('a', { repo: 'cloud' }),
      makePlan('b', { repo: 'public' }),
    ];
    const result = filterPlans(plans, { repo: 'public' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('filters by both tag and repo', () => {
    const plans = [
      makePlan('a', { tags: ['v1'], repo: 'cloud' }),
      makePlan('b', { tags: ['v1'], repo: 'public' }),
      makePlan('c', { tags: ['v2'], repo: 'cloud' }),
    ];
    const result = filterPlans(plans, { tag: 'v1', repo: 'cloud' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('returns all when no filters', () => {
    const plans = [makePlan('a'), makePlan('b')];
    const result = filterPlans(plans, {});
    expect(result).toHaveLength(2);
  });
});
