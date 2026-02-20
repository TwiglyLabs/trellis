import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture } from '../../__tests__/helpers.ts';
import { statusCommand } from './command.ts';

describe('status command', () => {
  let originalCwd: () => string;
  let logs: string[];

  beforeEach(() => {
    originalCwd = process.cwd;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logs.push(args.join(' '));
    });
  });

  afterEach(() => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
  });

  it('shows dashboard grouped by status', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
      { id: 'c', title: 'Plan C', status: 'in_progress' },
      { id: 'd', title: 'Plan D', status: 'draft' },
    ]);
    process.cwd = () => root;

    statusCommand({});

    const output = logs.join('\n');
    expect(output).toContain('READY');
    expect(output).toContain('IN PROGRESS');
    expect(output).toContain('DRAFT');
    expect(output).not.toContain('DONE'); // done hidden by default
    expect(output).toContain('3 plans'); // excludes done
  });

  it('shows blocked plans with waiting info', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    statusCommand({});

    const output = logs.join('\n');
    expect(output).toContain('BLOCKED');
    expect(output).toContain('waiting on');
  });

  it('filters by tag', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', tags: ['cloud'] },
      { id: 'b', title: 'Plan B', status: 'not_started', tags: ['public'] },
    ]);
    process.cwd = () => root;

    statusCommand({ tag: 'cloud' });

    const output = logs.join('\n');
    expect(output).toContain('1 plan');
  });

  it('includes assignee in JSON output', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'in_progress', assignee: 'agent-1' },
    ]);
    process.cwd = () => root;

    statusCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.plans[0].assignee).toBe('agent-1');
  });

  it('outputs JSON', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);
    process.cwd = () => root;

    statusCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.project).toBe('test-project');
    expect(parsed.plans).toHaveLength(1);
    expect(parsed.plans[0].id).toBe('a');
  });

  it('hides done plans by default', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    statusCommand({});

    const output = logs.join('\n');
    expect(output).toContain('READY');
    expect(output).toContain('b');
    expect(output).not.toContain('DONE');
    expect(output).toContain('1 plan');
  });

  it('hides archived plans by default', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'archived' },
      { id: 'b', title: 'Plan B', status: 'not_started' },
    ]);
    process.cwd = () => root;

    statusCommand({});

    const output = logs.join('\n');
    expect(output).not.toContain('ARCHIVED');
    expect(output).not.toContain('Plan A');
  });

  it('--all shows done and archived plans', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'archived' },
      { id: 'c', title: 'Plan C', status: 'not_started' },
    ]);
    process.cwd = () => root;

    statusCommand({ all: true });

    const output = logs.join('\n');
    expect(output).toContain('DONE');
    expect(output).toContain('3 plans');
  });

  it('--done shows done but not archived', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'archived' },
      { id: 'c', title: 'Plan C', status: 'not_started' },
    ]);
    process.cwd = () => root;

    statusCommand({ done: true });

    const output = logs.join('\n');
    expect(output).toContain('DONE');
    expect(output).not.toContain('ARCHIVED');
    expect(output).toContain('2 plans');
  });

  it('--archived shows archived but not done', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'archived' },
      { id: 'c', title: 'Plan C', status: 'not_started' },
    ]);
    process.cwd = () => root;

    statusCommand({ archived: true });

    const output = logs.join('\n');
    expect(output).not.toContain('DONE');
    expect(output).toContain('ARCHIVED');
    expect(output).toContain('2 plans');
  });

  it('--json respects default filter', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started' },
    ]);
    process.cwd = () => root;

    statusCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.plans).toHaveLength(1);
    expect(parsed.plans[0].id).toBe('b');
  });

  it('--json --all includes done and archived', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started' },
    ]);
    process.cwd = () => root;

    statusCommand({ json: true, all: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.plans).toHaveLength(2);
  });

  it('shows chunk summary line', () => {
    const { root } = createFixture([
      { id: 'contracts/core', title: 'Core', status: 'not_started' },
      { id: 'contracts/auth', title: 'Auth', status: 'not_started' },
      { id: 'impl/parser', title: 'Parser', status: 'not_started' },
    ]);
    process.cwd = () => root;

    statusCommand({});

    const output = logs.join('\n');
    expect(output).toContain('Chunks:');
    expect(output).toContain('discovered');
  });
});
