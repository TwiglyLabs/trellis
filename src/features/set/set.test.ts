import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { setCommand } from './command.ts';
import { createContext } from '../../core/index.ts';
import { computeSet } from './logic.ts';
import { computeShow } from '../show/logic.ts';
import { createFixture } from '../../__tests__/helpers.ts';

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

    const ctx = createContext(root);
    expect(computeShow({ planId: 'test', graph: ctx.graph })?.description).toBe('New desc');
  });

  it('adds to a list field with --add', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['a'], body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    setCommand('test', 'tags', ['b'], { add: true });

    expect(process.exitCode).toBeUndefined();
    const ctx = createContext(root);
    expect(computeShow({ planId: 'test', graph: ctx.graph })?.tags).toContain('b');
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
    const ctx = createContext(root);
    expect(computeShow({ planId: 'test', graph: ctx.graph })?.tags).not.toContain('a');
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

describe('computeSet', () => {
  it('updates a scalar frontmatter field', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    let ctx = createContext(root);
    const result = computeSet({ planId: 'test', field: 'description', value: 'Updated desc', mode: 'replace', graph: ctx.graph }, { refresh: () => { ctx = createContext(root); } });

    expect(result.field).toBe('description');
    expect(result.value).toBe('Updated desc');

    const plan = computeShow({ planId: 'test', graph: ctx.graph });
    expect(plan?.description).toBe('Updated desc');
  });

  it('rejects status field', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeSet({ planId: 'test', field: 'status', value: 'done', mode: 'replace', graph: ctx.graph }, { refresh: () => {} })).toThrow('status');
  });

  it('rejects unknown fields', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeSet({ planId: 'test', field: 'unknown_field', value: 'value', mode: 'replace', graph: ctx.graph }, { refresh: () => {} })).toThrow('unknown_field');
  });

  it('add mode appends to list fields', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['a'], body: '\n## Problem\nText\n' },
    ]);
    let ctx = createContext(root);
    computeSet({ planId: 'test', field: 'tags', value: 'b', mode: 'add', graph: ctx.graph }, { refresh: () => { ctx = createContext(root); } });

    const plan = computeShow({ planId: 'test', graph: ctx.graph });
    expect(plan?.tags).toContain('a');
    expect(plan?.tags).toContain('b');
  });

  it('remove mode removes from list fields', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['a', 'b', 'c'], body: '\n## Problem\nText\n' },
    ]);
    let ctx = createContext(root);
    computeSet({ planId: 'test', field: 'tags', value: 'b', mode: 'remove', graph: ctx.graph }, { refresh: () => { ctx = createContext(root); } });

    const plan = computeShow({ planId: 'test', graph: ctx.graph });
    expect(plan?.tags).toEqual(['a', 'c']);
  });

  it('errors on add/remove for scalar fields', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeSet({ planId: 'test', field: 'title', value: 'x', mode: 'add', graph: ctx.graph }, { refresh: () => {} })).toThrow('not a list');
  });

  it('validates depends_on references exist', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeSet({ planId: 'test', field: 'depends_on', value: 'nonexistent', mode: 'add', graph: ctx.graph }, { refresh: () => {} })).toThrow('nonexistent');
  });

  it('rejects plan not found', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);
    expect(() => computeSet({ planId: 'nonexistent', field: 'title', value: 'x', mode: 'replace', graph: ctx.graph }, { refresh: () => {} })).toThrow('not found');
  });

  it('replace mode for list field replaces entire value', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['old1', 'old2'], body: '\n## Problem\nText\n' },
    ]);
    let ctx = createContext(root);
    computeSet({ planId: 'test', field: 'tags', value: ['x', 'y'], mode: 'replace', graph: ctx.graph }, { refresh: () => { ctx = createContext(root); } });

    const plan = computeShow({ planId: 'test', graph: ctx.graph });
    expect(plan?.tags).toEqual(['x', 'y']);
    expect(plan?.tags).not.toContain('old1');
    expect(plan?.tags).not.toContain('old2');
  });

  it('set() with empty array clears a list field', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['a', 'b'], body: '\n## Problem\nText\n' },
    ]);
    let ctx = createContext(root);
    computeSet({ planId: 'test', field: 'tags', value: [], mode: 'replace', graph: ctx.graph }, { refresh: () => { ctx = createContext(root); } });

    const plan = computeShow({ planId: 'test', graph: ctx.graph });
    expect(plan?.tags).toEqual([]);
  });

  it('set() adding duplicate to list field', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['a'], body: '\n## Problem\nText\n' },
    ]);
    let ctx = createContext(root);
    computeSet({ planId: 'test', field: 'tags', value: 'a', mode: 'add', graph: ctx.graph }, { refresh: () => { ctx = createContext(root); } });

    const plan = computeShow({ planId: 'test', graph: ctx.graph });
    // Current behavior: duplicates are allowed
    const aTags = plan?.tags?.filter(tag => tag === 'a') ?? [];
    expect(aTags.length).toBe(2);
  });

  it('set() plan not found error wording', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);
    expect(() => computeSet({ planId: 'missing-plan', field: 'title', value: 'x', mode: 'replace', graph: ctx.graph }, { refresh: () => {} })).toThrow(/not found/i);
  });
});

describe('sessions and deviation fields', () => {
  it('sets sessions as a number via set()', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    const result = computeSet({ planId: 'a', field: 'sessions', value: '3', mode: 'replace', graph: ctx.graph }, { refresh: () => {} });
    expect(result.value).toBe(3);

    const content = readFileSync(join(root, 'plans', 'a', 'README.md'), 'utf8');
    expect(content).toContain('sessions: 3');
  });

  it('rejects non-integer sessions', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeSet({ planId: 'a', field: 'sessions', value: '1.5', mode: 'replace', graph: ctx.graph }, { refresh: () => {} })).toThrow('positive integer');
  });

  it('rejects zero sessions', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeSet({ planId: 'a', field: 'sessions', value: '0', mode: 'replace', graph: ctx.graph }, { refresh: () => {} })).toThrow('positive integer');
  });

  it('rejects negative sessions', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeSet({ planId: 'a', field: 'sessions', value: '-1', mode: 'replace', graph: ctx.graph }, { refresh: () => {} })).toThrow('positive integer');
  });

  it('sets deviation via set()', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    const result = computeSet({ planId: 'a', field: 'deviation', value: 'minor', mode: 'replace', graph: ctx.graph }, { refresh: () => {} });
    expect(result.value).toBe('minor');

    const content = readFileSync(join(root, 'plans', 'a', 'README.md'), 'utf8');
    expect(content).toContain('deviation: minor');
  });

  it('accepts all valid deviation values', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    for (const val of ['none', 'minor', 'major']) {
      computeSet({ planId: 'a', field: 'deviation', value: val, mode: 'replace', graph: ctx.graph }, { refresh: () => {} });
      const content = readFileSync(join(root, 'plans', 'a', 'README.md'), 'utf8');
      expect(content).toContain(`deviation: ${val}`);
    }
  });

  it('rejects invalid deviation', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeSet({ planId: 'a', field: 'deviation', value: 'huge', mode: 'replace', graph: ctx.graph }, { refresh: () => {} })).toThrow('"none", "minor", or "major"');
  });
});
