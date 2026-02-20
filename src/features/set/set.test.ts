import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { setCommand } from './command.ts';
import { Trellis } from '../../api.ts';
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

describe('Trellis.set', () => {
  it('updates a scalar frontmatter field', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    const result = t.set('test', 'description', 'Updated desc');

    expect(result.field).toBe('description');
    expect(result.value).toBe('Updated desc');

    const t2 = new Trellis(root);
    const plan = t2.show('test');
    expect(plan?.description).toBe('Updated desc');
  });

  it('rejects status field', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.set('test', 'status', 'done')).toThrow('status');
  });

  it('rejects unknown fields', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.set('test', 'unknown_field', 'value')).toThrow('unknown_field');
  });

  it('add mode appends to list fields', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['a'], body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    t.set('test', 'tags', 'b', 'add');

    const t2 = new Trellis(root);
    const plan = t2.show('test');
    expect(plan?.tags).toContain('a');
    expect(plan?.tags).toContain('b');
  });

  it('remove mode removes from list fields', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['a', 'b', 'c'], body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    t.set('test', 'tags', 'b', 'remove');

    const t2 = new Trellis(root);
    const plan = t2.show('test');
    expect(plan?.tags).toEqual(['a', 'c']);
  });

  it('errors on add/remove for scalar fields', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.set('test', 'title', 'x', 'add')).toThrow('not a list');
  });

  it('validates depends_on references exist', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.set('test', 'depends_on', 'nonexistent', 'add')).toThrow('nonexistent');
  });

  it('rejects plan not found', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    expect(() => t.set('nonexistent', 'title', 'x')).toThrow('not found');
  });

  it('replace mode for list field replaces entire value', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['old1', 'old2'], body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    t.set('test', 'tags', ['x', 'y'], 'replace');

    const t2 = new Trellis(root);
    const plan = t2.show('test');
    expect(plan?.tags).toEqual(['x', 'y']);
    expect(plan?.tags).not.toContain('old1');
    expect(plan?.tags).not.toContain('old2');
  });

  it('set() with empty array clears a list field', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['a', 'b'], body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    t.set('test', 'tags', [], 'replace');

    const t2 = new Trellis(root);
    const plan = t2.show('test');
    expect(plan?.tags).toEqual([]);
  });

  it('set() adding duplicate to list field', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['a'], body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    t.set('test', 'tags', 'a', 'add');

    const t2 = new Trellis(root);
    const plan = t2.show('test');
    // Current behavior: duplicates are allowed
    const aTags = plan?.tags?.filter(tag => tag === 'a') ?? [];
    expect(aTags.length).toBe(2);
  });

  it('set() plan not found error wording', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    expect(() => t.set('missing-plan', 'title', 'x')).toThrow(/not found/i);
  });
});

describe('sessions and deviation fields', () => {
  it('sets sessions as a number via set()', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    const result = t.set('a', 'sessions', '3');
    expect(result.value).toBe(3);

    const content = readFileSync(join(root, 'plans', 'a', 'README.md'), 'utf8');
    expect(content).toContain('sessions: 3');
  });

  it('rejects non-integer sessions', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.set('a', 'sessions', '1.5')).toThrow('positive integer');
  });

  it('rejects zero sessions', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.set('a', 'sessions', '0')).toThrow('positive integer');
  });

  it('rejects negative sessions', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.set('a', 'sessions', '-1')).toThrow('positive integer');
  });

  it('sets deviation via set()', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    const result = t.set('a', 'deviation', 'minor');
    expect(result.value).toBe('minor');

    const content = readFileSync(join(root, 'plans', 'a', 'README.md'), 'utf8');
    expect(content).toContain('deviation: minor');
  });

  it('accepts all valid deviation values', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    for (const val of ['none', 'minor', 'major']) {
      t.set('a', 'deviation', val);
      const content = readFileSync(join(root, 'plans', 'a', 'README.md'), 'utf8');
      expect(content).toContain(`deviation: ${val}`);
    }
  });

  it('rejects invalid deviation', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.set('a', 'deviation', 'huge')).toThrow('"none", "minor", or "major"');
  });
});
