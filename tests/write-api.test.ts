import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { Trellis } from '../src/api.ts';
import { createFixture } from './helpers.ts';

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
    // Should be parseable by gray-matter without errors
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

describe('Trellis.writeSection', () => {
  it('writes content to a section in readme', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nOld text\n## Approach\nOld approach\n' },
    ]);
    const t = new Trellis(root);
    const result = t.writeSection('test', 'readme', 'Problem', 'New problem text\n');

    expect(result.content).toContain('New problem text');

    const content = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    expect(content).toContain('New problem text');
    expect(content).toContain('## Approach');
  });

  it('creates missing optional files (outputs)', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    t.writeSection('test', 'outputs', 'Deliverables', '- API endpoint\n');

    expect(existsSync(join(root, 'plans', 'test', 'outputs.md'))).toBe(true);
    const content = readFileSync(join(root, 'plans', 'test', 'outputs.md'), 'utf8');
    expect(content).toContain('## Deliverables');
    expect(content).toContain('- API endpoint');
  });

  it('appends section when it does not exist', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    t.writeSection('test', 'readme', 'Approach', 'New approach\n');

    const content = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    expect(content).toContain('## Problem');
    expect(content).toContain('## Approach');
    expect(content).toContain('New approach');
  });

  it('rejects unknown plan', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    expect(() => t.writeSection('nonexistent', 'readme', 'Problem', 'text')).toThrow('not found');
  });

  it('rejects invalid file name', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.writeSection('test', 'invalid' as any, 'Problem', 'text')).toThrow('invalid');
  });

  it('writes to implementation file that already exists', () => {
    const { root } = createFixture([
      {
        id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\nText\n',
        implementationMd: '## Steps\n1. Do thing\n\n## Testing\nTest it\n\n## Done-when\nAll done\n',
      },
    ]);
    const t = new Trellis(root);
    t.writeSection('test', 'implementation', 'Steps', '1. Updated step\n');

    const content = readFileSync(join(root, 'plans', 'test', 'implementation.md'), 'utf8');
    expect(content).toContain('1. Updated step');
    expect(content).toContain('## Testing');
    expect(content).toContain('## Done-when');
  });

  it('throws for implementation file that does not exist', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.writeSection('test', 'implementation', 'Steps', '1. Step\n')).toThrow('does not exist');
  });
});

describe('Trellis.readSection', () => {
  it('reads full plan when no file/section specified', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    const result = t.readSection('test');

    expect(result.content).toContain('## Problem');
    expect(result.content).toContain('Text');
  });

  it('reads specific file', () => {
    const { root } = createFixture([
      {
        id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\nText\n',
        implementationMd: '## Steps\n1. Do thing\n\n## Testing\nTest it\n\n## Done-when\nAll done\n',
      },
    ]);
    const t = new Trellis(root);
    const result = t.readSection('test', 'implementation');

    expect(result.content).toContain('## Steps');
    expect(result.content).not.toContain('## Problem');
  });

  it('reads specific section from file', () => {
    const { root } = createFixture([
      {
        id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\nBroken\n## Approach\nFix it\n',
      },
    ]);
    const t = new Trellis(root);
    const result = t.readSection('test', 'readme', 'Problem');

    expect(result.content).toBe('Broken\n');
  });

  it('returns null content for missing section', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.readSection('test', 'readme', 'NonExistent')).toThrow('not found');
  });

  it('rejects unknown plan', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    expect(() => t.readSection('nonexistent')).toThrow('not found');
  });

  it('rejects missing file', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.readSection('test', 'outputs')).toThrow('does not exist');
  });

  it('readSection with no file strips README frontmatter', () => {
    const { root } = createFixture([
      { id: 'test', title: 'My Test Plan', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    const result = t.readSection('test');

    expect(result.content).not.toContain('---');
    expect(result.content).not.toContain('title:');
    expect(result.content).toContain('## Problem');
  });

  it('readSection with no file includes all existing files', () => {
    const { root } = createFixture([
      {
        id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\nText\n',
        implementationMd: '## Steps\n1. Do thing\n',
        outputsMd: '## Deliverables\n- Output\n',
      },
    ]);
    const t = new Trellis(root);
    const result = t.readSection('test');

    expect(result.content).toContain('## Problem');
    expect(result.content).toContain('## Steps');
    expect(result.content).toContain('## Deliverables');
    // Files should be separated by ---
    expect(result.content).toContain('---');
  });

  it('readSection preserves frontmatter fields after writeSection', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Original Title', status: 'draft', tags: ['foo'], body: '\n## Problem\nOld\n' },
    ]);
    const t = new Trellis(root);
    t.writeSection('test', 'readme', 'Problem', 'New content\n');

    const content = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    const parsed = matter(content);
    expect(parsed.data.title).toBe('Original Title');
    expect(parsed.data.status).toBe('draft');
    expect(parsed.data.tags).toContain('foo');
    expect(content).toContain('New content');
  });
});

describe('Trellis.rename', () => {
  it('renames plan directory', () => {
    const { root } = createFixture([
      { id: 'old-name', title: 'Plan', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    t.rename('old-name', 'new-name');

    expect(existsSync(join(root, 'plans', 'new-name', 'README.md'))).toBe(true);
    expect(existsSync(join(root, 'plans', 'old-name'))).toBe(false);
  });

  it('updates depends_on references in other plans', () => {
    const { root } = createFixture([
      { id: 'upstream', title: 'Upstream', status: 'done', body: '\n## Problem\nText\n' },
      { id: 'downstream', title: 'Downstream', status: 'draft', depends_on: ['upstream'], body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    t.rename('upstream', 'renamed');

    const t2 = new Trellis(root);
    const plan = t2.show('downstream');
    expect(plan?.dependsOn[0].id).toBe('renamed');
  });

  it('rejects if target already exists', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'draft', body: '\n## Problem\nText\n' },
      { id: 'b', title: 'B', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.rename('a', 'b')).toThrow('already exists');
  });

  it('rejects if source not found', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    expect(() => t.rename('nonexistent', 'new-name')).toThrow('not found');
  });

  it('rename rejects path traversal in new ID', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.rename('test', '../evil')).toThrow('Invalid plan ID');
  });
});

describe('Trellis.archive', () => {
  it('archives a plan by setting status to archived', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'done', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    const result = t.archive('test');

    expect(result.previousStatus).toBe('done');
    expect(result.newStatus).toBe('archived');
  });

  it('blocks archiving when plan has active dependents', () => {
    const { root } = createFixture([
      { id: 'upstream', title: 'Up', status: 'done', body: '\n## Problem\nText\n' },
      { id: 'downstream', title: 'Down', status: 'in_progress', depends_on: ['upstream'], body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    expect(() => t.archive('upstream')).toThrow('active dependents');
  });

  it('allows archiving when dependents are also done/archived', () => {
    const { root } = createFixture([
      { id: 'upstream', title: 'Up', status: 'done', body: '\n## Problem\nText\n' },
      { id: 'downstream', title: 'Down', status: 'done', depends_on: ['upstream'], body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    const result = t.archive('upstream');
    expect(result.newStatus).toBe('archived');
  });

  it('rejects unknown plan', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    expect(() => t.archive('nonexistent')).toThrow('not found');
  });

  it('archiving already-archived plan is idempotent', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'archived', body: '\n## Problem\nText\n' },
    ]);
    const t = new Trellis(root);
    const result = t.archive('test');

    expect(result.previousStatus).toBe('archived');
    expect(result.newStatus).toBe('archived');
  });
});
