import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture } from '../helpers.ts';
import { showCommand } from '../../src/commands/show.ts';

describe('show command', () => {
  let originalCwd: () => string;
  let logs: string[];
  let errors: string[];

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
    process.exitCode = undefined;
  });

  it('shows plan details', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'in_progress', tags: ['foundation'], repo: 'public' },
    ]);
    process.cwd = () => root;

    showCommand('a');

    const output = logs.join('\n');
    expect(output).toContain('Plan A');
    expect(output).toContain('in_progress');
    expect(output).toContain('foundation');
    expect(output).toContain('public');
  });

  it('shows dependency chain with status', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    showCommand('b');

    const output = logs.join('\n');
    expect(output).toContain('Depends on');
    expect(output).toContain('a');
    expect(output).toContain('done');
  });

  it('shows blocked status', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    showCommand('b');

    const output = logs.join('\n');
    expect(output).toContain('blocked');
    expect(output).toContain('blocking');
  });

  it('shows what the plan blocks', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
      { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
    ]);
    process.cwd = () => root;

    showCommand('a');

    const output = logs.join('\n');
    expect(output).toContain('Blocks');
    expect(output).toContain('b');
    expect(output).toContain('c');
    expect(output).toContain('transitive');
  });

  it('errors on missing plan', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    showCommand('nonexistent');

    expect(errors.join('\n')).toContain('not found');
  });

  it('outputs JSON', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], tags: ['infra'], description: 'B desc' },
      { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
    ]);
    process.cwd = () => root;

    showCommand('b', { json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.id).toBe('b');
    expect(parsed.title).toBe('Plan B');
    expect(parsed.status).toBe('not_started');
    expect(parsed.blocked).toBe(false);
    expect(parsed.ready).toBe(true);
    expect(parsed.depends_on).toEqual([{ id: 'a', status: 'done', satisfied: true }]);
    expect(parsed.blocks).toEqual(['c']);
    expect(parsed.critical_path).toEqual(['a', 'b']);
    expect(parsed.filePath).toContain('plans/b.md');
  });

  it('outputs JSON error for missing plan', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    showCommand('nonexistent', { json: true });

    const parsed = JSON.parse(errors.join(''));
    expect(parsed.error).toContain('not found');
  });

  it('shows critical path for deep chain', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
      { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
    ]);
    process.cwd = () => root;

    showCommand('c');

    const output = logs.join('\n');
    expect(output).toContain('Critical path');
    expect(output).toContain('depth 3');
    expect(output).toContain('a');
    expect(output).toContain('b');
    expect(output).toContain('c');
  });
});
