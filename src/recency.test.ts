import { describe, it, expect } from 'vitest';
import { computeRecentActivity } from './recency.ts';
import type { Plan } from './core/types.ts';

function makePlan(id: string, opts: {
  updatedAt?: Date;
  started_at?: string;
  completed_at?: string;
  not_started_at?: string;
} = {}): Plan {
  return {
    id,
    filePath: `plans/${id}/README.md`,
    frontmatter: {
      title: `Plan ${id}`,
      status: 'in_progress',
      started_at: opts.started_at,
      completed_at: opts.completed_at,
      not_started_at: opts.not_started_at,
    },
    body: '',
    lineCount: 10,
    updatedAt: opts.updatedAt ?? new Date(),
    fileHashes: { 'README.md': 'abc123' },
  };
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

describe('computeRecentActivity', () => {
  it('returns plan in contentChanged when updatedAt > since', () => {
    const plan = makePlan('a', { updatedAt: daysAgo(1) });
    const result = computeRecentActivity([plan], daysAgo(2));
    expect(result.contentChanged.map(p => p.id)).toEqual(['a']);
  });

  it('excludes plan from contentChanged when updatedAt < since', () => {
    const plan = makePlan('a', { updatedAt: daysAgo(3) });
    const result = computeRecentActivity([plan], daysAgo(2));
    expect(result.contentChanged).toHaveLength(0);
  });

  it('returns plan in statusChanged when status timestamp > since', () => {
    const plan = makePlan('a', {
      updatedAt: daysAgo(10),
      started_at: daysAgo(1).toISOString(),
    });
    const result = computeRecentActivity([plan], daysAgo(2));
    expect(result.statusChanged.map(p => p.id)).toEqual(['a']);
  });

  it('returns plan in newlyCreated when earliest timestamp is after since', () => {
    const plan = makePlan('a', {
      updatedAt: daysAgo(0),
      not_started_at: daysAgo(1).toISOString(),
    });
    const result = computeRecentActivity([plan], daysAgo(2));
    expect(result.newlyCreated.map(p => p.id)).toEqual(['a']);
  });

  it('does not mark plan as newlyCreated if earliest timestamp is before since', () => {
    const plan = makePlan('a', {
      updatedAt: daysAgo(0),
      not_started_at: daysAgo(5).toISOString(),
      started_at: daysAgo(1).toISOString(),
    });
    const result = computeRecentActivity([plan], daysAgo(2));
    // statusChanged yes (started_at is recent), but newlyCreated no (not_started_at is old)
    expect(result.statusChanged.map(p => p.id)).toEqual(['a']);
    expect(result.newlyCreated).toHaveLength(0);
  });

  it('plan can appear in multiple groups', () => {
    const plan = makePlan('a', {
      updatedAt: daysAgo(0),
      started_at: daysAgo(0).toISOString(),
      not_started_at: daysAgo(0).toISOString(),
    });
    const result = computeRecentActivity([plan], daysAgo(1));
    expect(result.contentChanged.map(p => p.id)).toContain('a');
    expect(result.statusChanged.map(p => p.id)).toContain('a');
    expect(result.newlyCreated.map(p => p.id)).toContain('a');
  });

  it('sorts each group by updatedAt descending', () => {
    const plans = [
      makePlan('old', { updatedAt: daysAgo(2) }),
      makePlan('new', { updatedAt: daysAgo(0) }),
      makePlan('mid', { updatedAt: daysAgo(1) }),
    ];
    const result = computeRecentActivity(plans, daysAgo(3));
    expect(result.contentChanged.map(p => p.id)).toEqual(['new', 'mid', 'old']);
  });

  it('returns empty arrays for empty plans', () => {
    const result = computeRecentActivity([], daysAgo(1));
    expect(result.contentChanged).toHaveLength(0);
    expect(result.statusChanged).toHaveLength(0);
    expect(result.newlyCreated).toHaveLength(0);
  });

  it('ignores plans with no status timestamps for statusChanged/newlyCreated', () => {
    const plan = makePlan('a', { updatedAt: daysAgo(0) });
    const result = computeRecentActivity([plan], daysAgo(1));
    expect(result.contentChanged.map(p => p.id)).toEqual(['a']);
    expect(result.statusChanged).toHaveLength(0);
    expect(result.newlyCreated).toHaveLength(0);
  });
});
