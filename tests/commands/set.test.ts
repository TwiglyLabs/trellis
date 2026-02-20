import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setCommand } from '../../src/commands/set.ts';
import { Trellis } from '../../src/api.ts';
import { createFixture } from '../../src/__tests__/helpers.ts';

describe('setCommand', () => {
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

  it('sets a scalar field', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    setCommand('test', 'description', ['New desc'], {});

    expect(process.exitCode).toBeUndefined();
    expect(logs.join('\n')).toContain('test.description = New desc');

    const t = new Trellis(root);
    expect(t.show('test')?.description).toBe('New desc');
  });

  it('adds to a list field with --add', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['a'], body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    setCommand('test', 'tags', ['b'], { add: true });

    expect(process.exitCode).toBeUndefined();
    const t = new Trellis(root);
    expect(t.show('test')?.tags).toContain('b');
  });

  it('outputs JSON with --json', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    setCommand('test', 'description', ['Desc'], { json: true });

    const output = JSON.parse(logs[0]);
    expect(output.field).toBe('description');
    expect(output.value).toBe('Desc');
  });

  it('errors on status field', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    setCommand('test', 'status', ['done'], {});

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('status');
  });

  it('removes from list with --remove', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['a', 'b'], body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    setCommand('test', 'tags', ['a'], { remove: true });

    expect(process.exitCode).toBeUndefined();
    const t = new Trellis(root);
    expect(t.show('test')?.tags).not.toContain('a');
  });

  it('sets multiple values', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    setCommand('test', 'tags', ['x', 'y'], {});

    expect(process.exitCode).toBeUndefined();
  });

  it('errors on unknown field', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    setCommand('test', 'bogus', ['val'], {});

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('bogus');
  });

  it('errors on plan not found', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    setCommand('ghost', 'title', ['x'], {});

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('not found');
  });
});
