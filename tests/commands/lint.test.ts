import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture } from '../helpers.ts';
import { lintCommand } from '../../src/commands/lint.ts';

describe('lint command', () => {
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
    process.exitCode = undefined;
  });

  it('passes clean plans', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('2 plans OK');
  });

  it('detects missing dependencies', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', depends_on: ['nonexistent'] },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('Unknown dependency');
    expect(output).toContain('nonexistent');
  });

  it('detects done plans with incomplete deps', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'done', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('b is done but depends on a');
  });

  it('warns about in_progress with incomplete deps', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'in_progress', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('b is in_progress but depends on a');
  });

  it('counts multi-error plans correctly for okCount', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'done', depends_on: ['a'] },
      // c has both a missing dep AND is done with incomplete dep
      { id: 'c', title: 'Plan C', status: 'done', depends_on: ['nonexistent', 'a'] },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    // c has multiple errors but should count as 1 plan with errors
    expect(output).toContain('2 of 3 plans OK');
  });

  it('detects orphaned draft plans', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'draft' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
      { id: 'c', title: 'Plan C', status: 'draft' },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('Orphaned plan: c');
    expect(output).not.toContain('Orphaned plan: a');
  });

  it('sets exit code with --strict and warnings', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'draft' },
    ]);
    process.cwd = () => root;

    lintCommand({ strict: true });

    expect(process.exitCode).toBe(1);
  });

  it('outputs JSON with errors and warnings', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', depends_on: ['nonexistent'] },
      { id: 'b', title: 'Plan B', status: 'draft' },
      { id: 'c', title: 'Plan C', status: 'done' },
    ]);
    process.cwd = () => root;

    lintCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.ok).toBe(false);
    expect(parsed.total).toBe(3);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.warnings.length).toBeGreaterThan(0);
    expect(parsed.errors[0]).toHaveProperty('plan_id');
    expect(parsed.errors[0]).toHaveProperty('type');
    expect(parsed.errors[0]).toHaveProperty('message');
  });

  it('outputs clean JSON when no issues', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', directory: true,
        outputsMd: '## Types\n- Person\n' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], directory: true,
        inputsMd: '## From plans\n\n### a\n- Person type\n' },
    ]);
    process.cwd = () => root;

    lintCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.ok).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it('does not set exit code without --strict for warnings only', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'draft' },
    ]);
    process.cwd = () => root;

    lintCommand();

    expect(process.exitCode).toBeUndefined();
  });

  it('warns when plan has dependents but no outputs.md', () => {
    const { root } = createFixture([
      { id: 'core', title: 'Core', status: 'not_started' },
      { id: 'parser', title: 'Parser', status: 'not_started', depends_on: ['core'] },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('core');
    expect(output).toContain('has dependents but no outputs.md');
  });

  it('errors when inputs.md references plan not in depends_on', () => {
    const { root } = createFixture([
      { id: 'upstream', title: 'Upstream', status: 'not_started', directory: true,
        outputsMd: '## Types\n- Person\n' },
      { id: 'consumer', title: 'Consumer', status: 'not_started', directory: true,
        inputsMd: '## From plans\n\n### upstream\n- Person type\n' },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('consumer');
    expect(output).toContain('references "upstream" not in depends_on');
    expect(process.exitCode).toBe(1);
  });

  it('warns when inputs.md references plan with no outputs.md', () => {
    const { root } = createFixture([
      { id: 'no-outputs', title: 'No Outputs', status: 'not_started' },
      { id: 'consumer', title: 'Consumer', status: 'not_started', depends_on: ['no-outputs'], directory: true,
        inputsMd: '## From plans\n\n### no-outputs\n- Something\n' },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('consumer');
    expect(output).toContain('no-outputs which has no outputs.md');
  });

  it('passes when contracts are consistent', () => {
    const { root } = createFixture([
      { id: 'upstream', title: 'Upstream', status: 'not_started', directory: true,
        outputsMd: '## Types\n- Person\n' },
      { id: 'consumer', title: 'Consumer', status: 'not_started', depends_on: ['upstream'], directory: true,
        inputsMd: '## From plans\n\n### upstream\n- Person type\n' },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('2 plans OK');
  });

  it('shows contract coverage in text output', () => {
    const { root } = createFixture([
      { id: 'core', title: 'Core', status: 'not_started', directory: true,
        outputsMd: '## Types\n- Person\n' },
      { id: 'parser', title: 'Parser', status: 'not_started', depends_on: ['core'] },
      { id: 'standalone', title: 'Standalone', status: 'not_started' },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('Contract coverage: 100%');
  });

  it('includes contract_coverage in JSON output', () => {
    const { root } = createFixture([
      { id: 'core', title: 'Core', status: 'not_started' },
      { id: 'parser', title: 'Parser', status: 'not_started', depends_on: ['core'] },
    ]);
    process.cwd = () => root;

    lintCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.contract_coverage).toBe(0);
  });
});
