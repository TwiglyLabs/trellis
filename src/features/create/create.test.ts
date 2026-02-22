import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { createCommand } from './command.ts';
import { createContext } from '../../core/index.ts';
import { computeCreate } from './logic.ts';
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

describe('computeCreate', () => {
  it('creates a plan directory with README.md', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);
    const result = computeCreate({ id: 'new-plan', opts: { title: 'New Plan' }, plansDir: ctx.plansDir, graph: ctx.graph });

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
    const ctx = createContext(root);
    computeCreate({ id: 'my-plan', opts: {
      title: 'My Plan',
      description: 'A test plan',
      depends_on: [],
      tags: ['test', 'foundation'],
    }, plansDir: ctx.plansDir, graph: ctx.graph });

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
    const ctx = createContext(root);
    expect(() => computeCreate({ id: 'existing', opts: { title: 'Dup' }, plansDir: ctx.plansDir, graph: ctx.graph })).toThrow('already exists');
  });

  it('requires title', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);
    expect(() => computeCreate({ id: 'test', opts: { title: '' }, plansDir: ctx.plansDir, graph: ctx.graph })).toThrow('title');
  });

  it('validates depends_on references exist', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);
    expect(() => computeCreate({ id: 'test', opts: { title: 'Test', depends_on: ['nonexistent'] }, plansDir: ctx.plansDir, graph: ctx.graph })).toThrow('nonexistent');
  });

  it('create() with YAML-special characters in title', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);
    const result = computeCreate({ id: 'special-title', opts: { title: 'My Plan: Part "1"' }, plansDir: ctx.plansDir, graph: ctx.graph });

    expect(result.id).toBe('special-title');
    const content = readFileSync(join(root, 'plans', 'special-title', 'README.md'), 'utf8');
    const parsed = matter(content);
    expect(parsed.data.title).toBe('My Plan: Part "1"');
    expect(parsed.data.status).toBe('draft');
  });

  it('create() with path traversal in ID rejects', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);
    expect(() => computeCreate({ id: '../evil', opts: { title: 'Evil' }, plansDir: ctx.plansDir, graph: ctx.graph })).toThrow('Invalid plan ID');
    expect(() => computeCreate({ id: './test', opts: { title: 'Test' }, plansDir: ctx.plansDir, graph: ctx.graph })).toThrow('Invalid plan ID');
    expect(() => computeCreate({ id: 'foo/bar', opts: { title: 'FooBar' }, plansDir: ctx.plansDir, graph: ctx.graph })).toThrow('Invalid plan ID');
  });

  it('create() with leading dot in ID rejects', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);
    expect(() => computeCreate({ id: '.hidden-plan', opts: { title: 'Hidden' }, plansDir: ctx.plansDir, graph: ctx.graph })).toThrow('Invalid plan ID');
  });
});
