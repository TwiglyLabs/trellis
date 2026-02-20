import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { createCommand } from './command.ts';
import { Trellis } from '../../api.ts';
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

describe('Trellis.create', () => {
  it('creates a plan directory with README.md', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    const result = t.create('new-plan', { title: 'New Plan' });

    expect(result.id).toBe('new-plan');
    expect(existsSync(join(root, 'plans', 'new-plan', 'README.md'))).toBe(true);

    const content = readFileSync(join(root, 'plans', 'new-plan', 'README.md'), 'utf8');
    expect(content).toContain('title: New Plan');
    expect(content).toContain('status: draft');
    expect(content).toContain('## Problem');
    expect(content).toContain('## Approach');
  });

  it('sets optional fields', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    t.create('my-plan', {
      title: 'My Plan',
      description: 'A test plan',
      depends_on: [],
      tags: ['test', 'foundation'],
    });

    const content = readFileSync(join(root, 'plans', 'my-plan', 'README.md'), 'utf8');
    expect(content).toContain('description: A test plan');
    expect(content).toContain('tags:');
    expect(content).toContain('test');
    expect(content).toContain('foundation');
  });

  it('rejects duplicate plan ID', () => {
    const { root } = createFixture([
      { id: 'existing', title: 'Existing', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.create('existing', { title: 'Dup' })).toThrow('already exists');
  });

  it('requires title', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    expect(() => t.create('test', { title: '' })).toThrow('title');
  });

  it('validates depends_on references exist', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    expect(() => t.create('test', { title: 'Test', depends_on: ['nonexistent'] })).toThrow('nonexistent');
  });

  it('create() with YAML-special characters in title', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    const result = t.create('special-title', { title: 'My Plan: Part "1"' });

    expect(result.id).toBe('special-title');
    const content = readFileSync(join(root, 'plans', 'special-title', 'README.md'), 'utf8');
    const parsed = matter(content);
    expect(parsed.data.title).toBe('My Plan: Part "1"');
    expect(parsed.data.status).toBe('draft');
  });

  it('create() with path traversal in ID rejects', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    expect(() => t.create('../evil', { title: 'Evil' })).toThrow('Invalid plan ID');
    expect(() => t.create('./test', { title: 'Test' })).toThrow('Invalid plan ID');
    expect(() => t.create('foo/bar', { title: 'FooBar' })).toThrow('Invalid plan ID');
  });

  it('create() with leading dot in ID rejects', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    expect(() => t.create('.hidden-plan', { title: 'Hidden' })).toThrow('Invalid plan ID');
  });
});
