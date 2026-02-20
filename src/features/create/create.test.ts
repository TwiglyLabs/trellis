import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { createCommand } from './command.ts';
import { createFixture } from '../../__tests__/helpers.ts';

describe('createCommand', () => {
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

  it('creates a plan directory', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    createCommand('new-plan', { title: 'New Plan' });

    expect(process.exitCode).toBeUndefined();
    expect(logs.join('\n')).toContain('Created plan new-plan');
    expect(existsSync(join(root, 'plans', 'new-plan', 'README.md'))).toBe(true);
  });

  it('outputs JSON with --json', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    createCommand('new-plan', { title: 'New Plan', json: true });

    const output = JSON.parse(logs[0]);
    expect(output.id).toBe('new-plan');
    expect(output.filePath).toContain('new-plan');
  });

  it('errors on duplicate ID', () => {
    const { root } = createFixture([
      { id: 'existing', title: 'Existing', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    createCommand('existing', { title: 'Dup' });

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('already exists');
  });

  it('creates with --depends-on', () => {
    const { root } = createFixture([
      { id: 'existing-plan', title: 'Existing', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    createCommand('child', { title: 'Child', dependsOn: ['existing-plan'] });

    expect(process.exitCode).toBeUndefined();
  });

  it('creates with --tags and --description', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    createCommand('new', { title: 'New', tags: ['a', 'b'], description: 'Desc' });

    expect(process.exitCode).toBeUndefined();
  });

  it('JSON error on duplicate', () => {
    const { root } = createFixture([
      { id: 'existing', title: 'Existing', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    createCommand('existing', { title: 'Dup', json: true });

    expect(process.exitCode).toBe(1);
    const parsed = JSON.parse(errors[0]);
    expect(parsed).toHaveProperty('error');
  });
});
