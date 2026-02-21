import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture } from '../../__tests__/helpers.ts';
import { lintCommand } from './command.ts';

// Well-formed plan body and implementation for plans that should pass structural checks
const VALID_BODY = '\n## Problem\n\nSome problem\n\n## Approach\n\nSome approach\n';
const VALID_IMPL = '## Steps\n\nSome steps\n\n## Testing\n\nSome tests\n\n## Done-when\n\nSome criteria\n';

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
      { id: 'a', title: 'Plan A', status: 'done', body: VALID_BODY, implementationMd: VALID_IMPL,
        outputsMd: '## Types\n- Person\n' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'],
        body: VALID_BODY, implementationMd: VALID_IMPL,
        inputsMd: '## From plans\n\n### a\n- types\n' },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toMatch(/^.*2 plans OK$/m);
    expect(process.exitCode).toBeUndefined();
  });

  it('detects missing dependencies', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', depends_on: ['nonexistent'],
        body: VALID_BODY, implementationMd: VALID_IMPL },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('Unknown dependency');
    expect(output).toContain('nonexistent');
  });

  it('detects done plans with incomplete deps', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', body: VALID_BODY, implementationMd: VALID_IMPL },
      { id: 'b', title: 'Plan B', status: 'done', depends_on: ['a'],
        body: VALID_BODY, implementationMd: VALID_IMPL,
        inputsMd: '## From plans\n\n### a\n- types\n' },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('b is done but depends on a');
  });

  it('warns about in_progress with incomplete deps', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', body: VALID_BODY, implementationMd: VALID_IMPL },
      { id: 'b', title: 'Plan B', status: 'in_progress', depends_on: ['a'],
        body: VALID_BODY, implementationMd: VALID_IMPL,
        inputsMd: '## From plans\n\n### a\n- types\n' },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('b is in_progress but depends on a');
  });

  it('counts multi-error plans correctly for okCount', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', body: VALID_BODY, implementationMd: VALID_IMPL,
        outputsMd: '## Types\n- Person\n' },
      { id: 'b', title: 'Plan B', status: 'done', depends_on: ['a'],
        body: VALID_BODY, implementationMd: VALID_IMPL,
        inputsMd: '## From plans\n\n### a\n- types\n' },
      // c has both a missing dep AND is done with incomplete dep
      { id: 'c', title: 'Plan C', status: 'done', depends_on: ['nonexistent', 'a'],
        body: VALID_BODY, implementationMd: VALID_IMPL,
        inputsMd: '## From plans\n\n### a\n- types\n' },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    // c has multiple errors but should count as 1 plan with errors
    expect(output).toContain('2 of 3 plans OK');
  });

  it('detects orphaned draft plans', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'draft', body: '\n## Problem\n\nP\n' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'],
        body: VALID_BODY, implementationMd: VALID_IMPL,
        inputsMd: '## From plans\n\n### a\n- types\n' },
      { id: 'c', title: 'Plan C', status: 'draft', body: '\n## Problem\n\nP\n' },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('Orphaned plan: c');
    expect(output).not.toContain('Orphaned plan: a');
  });

  it('sets exit code with --strict and warnings', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'draft', body: '\n## Problem\n\nP\n' },
    ]);
    process.cwd = () => root;

    lintCommand({ strict: true });

    expect(process.exitCode).toBe(1);
  });

  it('outputs JSON with errors and warnings', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', depends_on: ['nonexistent'],
        body: VALID_BODY, implementationMd: VALID_IMPL },
      { id: 'b', title: 'Plan B', status: 'draft', body: '\n## Problem\n\nP\n' },
      { id: 'c', title: 'Plan C', status: 'done', body: VALID_BODY, implementationMd: VALID_IMPL },
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
    expect(parsed.structural).toBeDefined();
  });

  it('outputs clean JSON when no issues', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', body: VALID_BODY, implementationMd: VALID_IMPL,
        outputsMd: '## Types\n- Person\n' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'],
        body: VALID_BODY, implementationMd: VALID_IMPL,
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
    // Draft plan with proper ## Problem — only generates orphan warning, no errors
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'draft', body: '\n## Problem\n\nP\n' },
    ]);
    process.cwd = () => root;

    lintCommand();

    expect(process.exitCode).toBeUndefined();
  });

  it('warns when plan has dependents but no outputs.md', () => {
    const { root } = createFixture([
      { id: 'core', title: 'Core', status: 'not_started', body: VALID_BODY, implementationMd: VALID_IMPL },
      { id: 'parser', title: 'Parser', status: 'not_started', depends_on: ['core'],
        body: VALID_BODY, implementationMd: VALID_IMPL,
        inputsMd: '## From plans\n\n### core\n- types\n' },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('core');
    expect(output).toContain('has dependents but no outputs.md');
  });

  it('passes when contracts are consistent', () => {
    const { root } = createFixture([
      { id: 'upstream', title: 'Upstream', status: 'not_started',
        body: VALID_BODY, implementationMd: VALID_IMPL,
        outputsMd: '## Types\n- Person\n' },
      { id: 'consumer', title: 'Consumer', status: 'not_started', depends_on: ['upstream'],
        body: VALID_BODY, implementationMd: VALID_IMPL,
        inputsMd: '## From plans\n\n### upstream\n- Person type\n' },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toMatch(/^.*2 plans OK$/m);
    expect(process.exitCode).toBeUndefined();
  });

  describe('--completeness flag', () => {
    it('emits warnings for stub sections', () => {
      const { root } = createFixture([
        { id: 'stub', title: 'Stub Plan', status: 'draft', body: '\n## Problem\nTBD\n' },
      ]);
      process.cwd = () => root;

      lintCommand({ completeness: true });

      const output = logs.join('\n');
      expect(output).toContain('stub: Problem is stub');
    });

    it('does not emit completeness warnings without --completeness', () => {
      const { root } = createFixture([
        { id: 'stub', title: 'Stub Plan', status: 'draft', body: '\n## Problem\nTBD\n' },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).not.toContain('Problem is stub');
    });

    it('emits warnings for thin sections', () => {
      const words25 = Array(25).fill('word').join(' ');
      const { root } = createFixture([
        { id: 'thin', title: 'Thin Plan', status: 'draft', body: `\n## Problem\n${words25}\n` },
      ]);
      process.cwd = () => root;

      lintCommand({ completeness: true });

      const output = logs.join('\n');
      expect(output).toContain('thin: Problem is thin (25 words)');
    });

    it('does not warn for complete sections', () => {
      const words60 = Array(60).fill('word').join(' ');
      const { root } = createFixture([
        { id: 'full', title: 'Full Plan', status: 'draft', body: `\n## Problem\n${words60}\n` },
      ]);
      process.cwd = () => root;

      lintCommand({ completeness: true });

      const output = logs.join('\n');
      expect(output).not.toContain('full: Problem');
    });

    it('with --strict, stub sections cause exit code 1', () => {
      const { root } = createFixture([
        { id: 'stub', title: 'Stub Plan', status: 'draft', body: '\n## Problem\nTBD\n' },
      ]);
      process.cwd = () => root;

      lintCommand({ completeness: true, strict: true });

      expect(process.exitCode).toBe(1);
    });

    it('includes completeness warnings in JSON output', () => {
      const { root } = createFixture([
        { id: 'stub', title: 'Stub Plan', status: 'draft', body: '\n## Problem\nTBD\n' },
      ]);
      process.cwd = () => root;

      lintCommand({ completeness: true, json: true });

      const parsed = JSON.parse(logs.join(''));
      const completenessWarnings = parsed.warnings.filter((w: any) => w.type === 'completeness');
      expect(completenessWarnings.length).toBeGreaterThan(0);
      expect(completenessWarnings[0].message).toContain('Problem is stub');
    });
  });
});
