import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture } from '../../__tests__/helpers.ts';
import { showCommand } from './command.ts';

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

  it('shows plan details', async () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'in_progress', tags: ['foundation'], repo: 'public' },
    ]);
    process.cwd = () => root;

    await showCommand('a');

    const output = logs.join('\n');
    expect(output).toContain('Plan A');
    expect(output).toContain('in_progress');
    expect(output).toContain('foundation');
    expect(output).toContain('public');
  });

  it('shows dependency chain with status', async () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    await showCommand('b');

    const output = logs.join('\n');
    expect(output).toContain('Depends on');
    expect(output).toContain('a');
    expect(output).toContain('done');
  });

  it('shows blocked status', async () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    await showCommand('b');

    const output = logs.join('\n');
    expect(output).toContain('blocked');
    expect(output).toContain('blocking');
  });

  it('shows what the plan blocks', async () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
      { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
    ]);
    process.cwd = () => root;

    await showCommand('a');

    const output = logs.join('\n');
    expect(output).toContain('Blocks');
    expect(output).toContain('b');
    expect(output).toContain('c');
    expect(output).toContain('transitive');
  });

  it('errors on missing plan', async () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    await showCommand('nonexistent');

    expect(errors.join('\n')).toContain('not found');
  });

  it('outputs JSON', async () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], tags: ['infra'], description: 'B desc' },
      { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
    ]);
    process.cwd = () => root;

    await showCommand('b', { json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.id).toBe('b');
    expect(parsed.title).toBe('Plan B');
    expect(parsed.status).toBe('not_started');
    expect(parsed.blocked).toBe(false);
    expect(parsed.ready).toBe(true);
    expect(parsed.depends_on).toEqual([{ id: 'a', status: 'done', satisfied: true }]);
    expect(parsed.blocks).toEqual(['c']);
    expect(parsed.critical_path).toEqual(['a', 'b']);
    expect(parsed.filePath).toContain('plans/b/README.md');
  });

  it('outputs JSON error for missing plan', async () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    await showCommand('nonexistent', { json: true });

    const parsed = JSON.parse(errors.join(''));
    expect(parsed.error).toContain('not found');
  });

  it('shows critical path for deep chain', async () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
      { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
    ]);
    process.cwd = () => root;

    await showCommand('c');

    const output = logs.join('\n');
    expect(output).toContain('Critical path');
    expect(output).toContain('depth 3');
    expect(output).toContain('a');
    expect(output).toContain('b');
    expect(output).toContain('c');
  });

  it('shows contracts with --contracts flag', async () => {
    const { root } = createFixture([
      { id: 'core', title: 'Core', status: 'not_started', directory: true,
        outputsMd: '## Types\n- Person\n- Family\n',
        inputsMd: '## From existing code\n\n### src/db.ts\n- DB connection\n' },
    ]);
    process.cwd = () => root;

    await showCommand('core', { contracts: true });

    const output = logs.join('\n');
    expect(output).toContain('Inputs:');
    expect(output).toContain('src/db.ts');
    expect(output).toContain('Outputs:');
    expect(output).toContain('Types');
    expect(output).toContain('Person');
  });

  it('shows (none) for missing contracts with --contracts flag', async () => {
    const { root } = createFixture([
      { id: 'bare', title: 'Bare Plan', status: 'not_started' },
    ]);
    process.cwd = () => root;

    await showCommand('bare', { contracts: true });

    const output = logs.join('\n');
    expect(output).toContain('Inputs:');
    expect(output).toContain('(none)');
    expect(output).toContain('Outputs:');
  });

  it('does not show contracts without --contracts flag', async () => {
    const { root } = createFixture([
      { id: 'core', title: 'Core', status: 'not_started', directory: true,
        outputsMd: '## Types\n- Person\n' },
    ]);
    process.cwd = () => root;

    await showCommand('core');

    const output = logs.join('\n');
    expect(output).not.toContain('Inputs:');
    expect(output).not.toContain('Outputs:');
  });

  it('includes contracts in JSON output with --contracts flag', async () => {
    const { root } = createFixture([
      { id: 'core', title: 'Core', status: 'not_started', directory: true,
        outputsMd: '## Types\n- Person\n- Family\n',
        inputsMd: '## From plans\n\n### upstream\n- Data\n' },
    ]);
    process.cwd = () => root;

    await showCommand('core', { json: true, contracts: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.outputs).toBeDefined();
    expect(parsed.outputs[0].heading).toBe('Types');
    expect(parsed.outputs[0].items).toContain('Person');
    expect(parsed.inputs).toBeDefined();
  });

  it('omits contracts from JSON output without --contracts flag', async () => {
    const { root } = createFixture([
      { id: 'core', title: 'Core', status: 'not_started', directory: true,
        outputsMd: '## Types\n- Person\n' },
    ]);
    process.cwd = () => root;

    await showCommand('core', { json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.outputs).toBeUndefined();
    expect(parsed.inputs).toBeUndefined();
  });
});
