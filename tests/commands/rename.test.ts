import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { renameCommand } from '../../src/commands/rename.ts';
import { Trellis } from '../../src/api.ts';
import { createFixture } from '../../src/__tests__/helpers.ts';

describe('renameCommand', () => {
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

  it('renames a plan', () => {
    const { root } = createFixture([
      { id: 'old-name', title: 'Plan', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    renameCommand('old-name', 'new-name');

    expect(process.exitCode).toBeUndefined();
    expect(logs.join('\n')).toContain('Renamed old-name → new-name');
    expect(existsSync(join(root, 'plans', 'new-name', 'README.md'))).toBe(true);
    expect(existsSync(join(root, 'plans', 'old-name'))).toBe(false);
  });

  it('outputs JSON with --json', () => {
    const { root } = createFixture([
      { id: 'old-name', title: 'Plan', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    renameCommand('old-name', 'new-name', { json: true });

    const output = JSON.parse(logs[0]);
    expect(output.old_id).toBe('old-name');
    expect(output.new_id).toBe('new-name');
  });

  it('reports updated references', () => {
    const { root } = createFixture([
      { id: 'upstream', title: 'Up', status: 'done', body: '\n## Problem\nText\n' },
      { id: 'downstream', title: 'Down', status: 'draft', depends_on: ['upstream'], body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    renameCommand('upstream', 'renamed');

    expect(logs.join('\n')).toContain('downstream');
  });

  it('errors on nonexistent source', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    renameCommand('nonexistent', 'new-name');

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('not found');
  });
});
