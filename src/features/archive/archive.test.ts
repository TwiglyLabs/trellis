import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { archiveCommand } from './command.ts';
import { createContext } from '../../core/index.ts';
import { computeArchive } from './logic.ts';
import { computeShow } from '../show/logic.ts';
import { createFixture } from '../../__tests__/helpers.ts';

describe('archiveCommand', () => {
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

  it('archives a plan', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    archiveCommand('test');

    expect(process.exitCode).toBeUndefined();
    expect(logs.join('\n')).toContain('Archived test');

    const ctx = createContext(root);
    const plan = computeShow({ planId: 'test', graph: ctx.graph });
    expect(plan?.status).toBe('archived');
  });

  it('outputs JSON with --json', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    archiveCommand('test', { json: true });

    const output = JSON.parse(logs[0]);
    expect(output.id).toBe('test');
    expect(output.status).toBe('archived');
  });

  it('errors on active dependents', () => {
    const { root } = createFixture([
      { id: 'upstream', title: 'Up', status: 'done', body: '\n## Problem\nText\n' },
      { id: 'downstream', title: 'Down', status: 'in_progress', depends_on: ['upstream'], body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    archiveCommand('upstream');

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('active dependents');
  });

  it('archives already-archived plan', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'archived', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    archiveCommand('test');

    expect(process.exitCode).toBeUndefined();
  });

  it('errors on nonexistent plan', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    archiveCommand('ghost');

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('not found');
  });

  it('JSON error on active dependents', () => {
    const { root } = createFixture([
      { id: 'upstream', title: 'Up', status: 'done', body: '\n## Problem\nText\n' },
      { id: 'downstream', title: 'Down', status: 'in_progress', depends_on: ['upstream'], body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    archiveCommand('upstream', { json: true });

    expect(process.exitCode).toBe(1);
    const parsed = JSON.parse(errors[0]);
    expect(parsed).toHaveProperty('error');
  });
});

describe('computeArchive', () => {
  it('archives a plan by setting status to archived', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    const result = computeArchive({ planId: 'test', graph: ctx.graph }, { refresh: () => {} });

    expect(result.previousStatus).toBe('done');
    expect(result.newStatus).toBe('archived');
  });

  it('blocks archiving when plan has active dependents', () => {
    const { root } = createFixture([
      { id: 'upstream', title: 'Up', status: 'done', body: '\n## Problem\nText\n' },
      { id: 'downstream', title: 'Down', status: 'in_progress', depends_on: ['upstream'], body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeArchive({ planId: 'upstream', graph: ctx.graph }, { refresh: () => {} })).toThrow('active dependents');
  });

  it('allows archiving when dependents are also done/archived', () => {
    const { root } = createFixture([
      { id: 'upstream', title: 'Up', status: 'done', body: '\n## Problem\nText\n' },
      { id: 'downstream', title: 'Down', status: 'done', depends_on: ['upstream'], body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    const result = computeArchive({ planId: 'upstream', graph: ctx.graph }, { refresh: () => {} });
    expect(result.newStatus).toBe('archived');
  });

  it('rejects unknown plan', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);
    expect(() => computeArchive({ planId: 'nonexistent', graph: ctx.graph }, { refresh: () => {} })).toThrow('not found');
  });

  it('archiving already-archived plan is idempotent', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'archived', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    const result = computeArchive({ planId: 'test', graph: ctx.graph }, { refresh: () => {} });

    expect(result.previousStatus).toBe('archived');
    expect(result.newStatus).toBe('archived');
  });
});
