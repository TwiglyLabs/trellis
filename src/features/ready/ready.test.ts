import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture } from '../../__tests__/helpers.ts';
import { readyCommand } from './command.ts';

describe('ready command', () => {
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

  it('lists ready plans', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
      { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
    ]);
    process.cwd = () => root;

    readyCommand({});

    const output = logs.join('\n');
    expect(output).toContain('b');
    expect(output).not.toContain('\nc');
  });

  it('shows message when no plans ready', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'in_progress' },
    ]);
    process.cwd = () => root;

    readyCommand({});

    expect(logs.join('\n')).toContain('No plans are ready');
  });

  it('outputs JSON', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], tags: ['infra'], repo: 'public', description: 'B desc' },
      { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
    ]);
    process.cwd = () => root;

    readyCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('b');
    expect(parsed[0].title).toBe('Plan B');
    expect(parsed[0].depends_on).toEqual(['a']);
    expect(parsed[0].tags).toEqual(['infra']);
    expect(parsed[0].repo).toBe('public');
    expect(parsed[0].description).toBe('B desc');
  });

  it('outputs empty JSON array when no plans ready', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'in_progress' },
    ]);
    process.cwd = () => root;

    readyCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed).toEqual([]);
  });

  it('--next returns single highest-priority plan', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
      { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
      { id: 'd', title: 'Plan D', status: 'not_started' },
    ]);
    process.cwd = () => root;

    readyCommand({ next: true });

    const output = logs.join('\n');
    expect(output).toContain('a');
    // Should NOT list d — only one plan
    const lines = output.split('\n').filter(l => l.trim());
    expect(lines).toHaveLength(1);
  });

  it('--next with --json returns single plan object', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    readyCommand({ next: true, json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.id).toBe('a');
    expect(parsed.title).toBe('Plan A');
  });

  it('--next with nothing ready shows message', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'in_progress' },
    ]);
    process.cwd = () => root;

    readyCommand({ next: true });

    expect(logs.join('\n')).toContain('No plans are ready');
  });

  it('--next with --json and nothing ready returns null', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'in_progress' },
    ]);
    process.cwd = () => root;

    readyCommand({ next: true, json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed).toBeNull();
  });

  it('filters by repo', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', repo: 'cloud' },
      { id: 'b', title: 'Plan B', status: 'not_started', repo: 'public' },
    ]);
    process.cwd = () => root;

    readyCommand({ repo: 'cloud' });

    const output = logs.join('\n');
    expect(output).toContain('a');
    expect(output).not.toContain('\nb');
  });
});
