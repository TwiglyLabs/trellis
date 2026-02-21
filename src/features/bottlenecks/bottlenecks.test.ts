import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmSync, utimesSync } from 'fs';
import { join } from 'path';
import { createFixture } from '../../__tests__/helpers.ts';
import { bottlenecksCommand } from './command.ts';

describe('bottlenecks command', () => {
  let originalCwd: () => string;
  let logs: string[];
  let errors: string[];
  let fixtureRoot: string | null = null;

  beforeEach(() => {
    originalCwd = process.cwd;
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logs.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      errors.push(args.join(' '));
    });
  });

  afterEach(() => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
    if (fixtureRoot) {
      try { rmSync(fixtureRoot, { recursive: true, force: true }); } catch {}
      fixtureRoot = null;
    }
  });

  it('shows "No bottlenecks detected" for healthy project', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started' },
    ]);
    fixtureRoot = root;
    process.cwd = () => root;

    bottlenecksCommand({});

    const output = logs.join('\n');
    expect(output).toContain('Project Health');
    expect(output).toContain('No bottlenecks detected');
  });

  it('shows stuck plans section', () => {
    const { root } = createFixture([
      { id: 'stuck-plan', title: 'Stuck Plan', status: 'in_progress', started_at: '2020-01-01' },
    ]);
    fixtureRoot = root;
    // Set old mtime so updatedAt is also old (stuck = stale + no recent content edits)
    const oldDate = new Date('2020-01-02');
    utimesSync(join(root, 'plans', 'stuck-plan', 'README.md'), oldDate, oldDate);
    process.cwd = () => root;

    bottlenecksCommand({});

    const output = logs.join('\n');
    expect(output).toContain('Stuck Plans');
    expect(output).toContain('stuck-plan');
  });

  it('shows top blockers section', () => {
    const { root } = createFixture([
      { id: 'blocker', title: 'The Blocker', status: 'in_progress' },
      { id: 'child-a', title: 'Child A', status: 'not_started', depends_on: ['blocker'] },
      { id: 'child-b', title: 'Child B', status: 'not_started', depends_on: ['blocker'] },
    ]);
    fixtureRoot = root;
    process.cwd = () => root;

    bottlenecksCommand({});

    const output = logs.join('\n');
    expect(output).toContain('Top Blockers');
    expect(output).toContain('blocker');
    expect(output).toContain('2');
  });

  it('shows stale plans section', () => {
    const { root } = createFixture([
      { id: 'stale-plan', title: 'Stale Plan', status: 'in_progress', started_at: '2020-01-01' },
    ]);
    fixtureRoot = root;
    process.cwd = () => root;

    bottlenecksCommand({});

    const output = logs.join('\n');
    expect(output).toContain('Stale Plans');
    expect(output).toContain('stale-plan');
  });

  it('shows queue pressure section', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'in_progress' },
      { id: 'b', title: 'B', status: 'not_started', depends_on: ['a'] },
      { id: 'c', title: 'C', status: 'not_started', depends_on: ['a'] },
      { id: 'd', title: 'D', status: 'not_started', depends_on: ['a'] },
    ]);
    fixtureRoot = root;
    process.cwd = () => root;

    bottlenecksCommand({});

    const output = logs.join('\n');
    expect(output).toContain('Queue Pressure');
    expect(output).toContain('layer');
  });

  it('outputs valid JSON with --json flag', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'in_progress', started_at: '2020-01-01' },
      { id: 'b', title: 'B', status: 'not_started', depends_on: ['a'] },
    ]);
    fixtureRoot = root;
    process.cwd = () => root;

    bottlenecksCommand({ json: true });

    const output = JSON.parse(logs[0]);
    expect(output).toHaveProperty('highBlockingPlans');
    expect(output).toHaveProperty('stuckPlans');
    expect(output).toHaveProperty('stalePlans');
    expect(output).toHaveProperty('layerPressure');
    expect(output).toHaveProperty('healthSummary');
  });

  it('shows health summary counts', () => {
    const { root } = createFixture([
      { id: 'active', title: 'Active', status: 'in_progress' },
      { id: 'blocked', title: 'Blocked', status: 'not_started', depends_on: ['active'] },
      { id: 'ready', title: 'Ready', status: 'not_started' },
      { id: 'done', title: 'Done', status: 'done', completed_at: '2026-01-01' },
    ]);
    fixtureRoot = root;
    process.cwd = () => root;

    bottlenecksCommand({});

    const output = logs.join('\n');
    expect(output).toContain('4 plans');
    expect(output).toContain('1 active');
    expect(output).toContain('1 blocked');
    expect(output).toContain('1 ready');
  });
});
