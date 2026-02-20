import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { renameCommand } from './command.ts';
import { createContext } from '../../core/index.ts';
import { computeRename } from './logic.ts';
import { computeShow } from '../show/logic.ts';
import { createFixture } from '../../__tests__/helpers.ts';

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

describe('computeRename', () => {
  it('renames plan directory', () => {
    const { root } = createFixture([
      { id: 'old-name', title: 'Plan', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    computeRename({ oldId: 'old-name', newId: 'new-name', plansDir: ctx.plansDir, graph: ctx.graph }, { refresh: () => {} });

    expect(existsSync(join(root, 'plans', 'new-name', 'README.md'))).toBe(true);
    expect(existsSync(join(root, 'plans', 'old-name'))).toBe(false);
  });

  it('updates depends_on references in other plans', () => {
    const { root } = createFixture([
      { id: 'upstream', title: 'Upstream', status: 'done', body: '\n## Problem\nText\n' },
      { id: 'downstream', title: 'Downstream', status: 'draft', depends_on: ['upstream'], body: '\n## Problem\nText\n' },
    ]);
    let ctx = createContext(root);
    computeRename({ oldId: 'upstream', newId: 'renamed', plansDir: ctx.plansDir, graph: ctx.graph }, { refresh: () => {} });

    const ctx2 = createContext(root);
    const plan = computeShow({ planId: 'downstream', graph: ctx2.graph });
    expect(plan?.dependsOn[0].id).toBe('renamed');
  });

  it('rejects if target already exists', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'draft', body: '\n## Problem\nText\n' },
      { id: 'b', title: 'B', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeRename({ oldId: 'a', newId: 'b', plansDir: ctx.plansDir, graph: ctx.graph }, { refresh: () => {} })).toThrow('already exists');
  });

  it('rejects if source not found', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);
    expect(() => computeRename({ oldId: 'nonexistent', newId: 'new-name', plansDir: ctx.plansDir, graph: ctx.graph }, { refresh: () => {} })).toThrow('not found');
  });

  it('rename rejects path traversal in new ID', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeRename({ oldId: 'test', newId: '../evil', plansDir: ctx.plansDir, graph: ctx.graph }, { refresh: () => {} })).toThrow('Invalid plan ID');
  });
});
