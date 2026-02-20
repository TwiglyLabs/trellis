import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { readSection, writeSection } from '../../core/schema.ts';
import { Trellis } from '../../api.ts';
import { createFixture } from '../../__tests__/helpers.ts';

// --- Core readSection/writeSection primitives ---

describe('readSection', () => {
  it('returns full content when no section specified', () => {
    const content = '## Problem\nSome text\n## Approach\nMore text\n';
    expect(readSection(content)).toBe(content);
  });

  it('returns section content between ## boundaries', () => {
    const content = '## Problem\nBroken thing\nDetails here\n## Approach\nFix it\n';
    expect(readSection(content, 'Problem')).toBe('Broken thing\nDetails here\n');
  });

  it('returns section content up to EOF when last section', () => {
    const content = '## Problem\nBroken\n## Approach\nFix it\nWith details\n';
    expect(readSection(content, 'Approach')).toBe('Fix it\nWith details\n');
  });

  it('returns null for non-existent section', () => {
    const content = '## Problem\nText\n';
    expect(readSection(content, 'NonExistent')).toBeNull();
  });

  it('preserves subheadings within section', () => {
    const content = '## Problem\nText\n### Details\nMore\n### Impact\nBig\n## Approach\nFix\n';
    expect(readSection(content, 'Problem')).toBe('Text\n### Details\nMore\n### Impact\nBig\n');
  });

  it('handles empty section', () => {
    const content = '## Problem\n## Approach\nFix\n';
    expect(readSection(content, 'Problem')).toBe('');
  });

  it('handles content before first section', () => {
    const content = 'Some preamble\n\n## Problem\nText\n';
    expect(readSection(content, 'Problem')).toBe('Text\n');
  });

  it('ignores ## inside fenced code blocks', () => {
    const content = '## Problem\nText\n```\n## Fake\n```\nMore text\n## Approach\nFix\n';
    expect(readSection(content, 'Problem')).toBe('Text\n```\n## Fake\n```\nMore text\n');
  });

  it('is case-sensitive for section names', () => {
    const content = '## Problem\nText\n## problem\nOther\n';
    expect(readSection(content, 'Problem')).toBe('Text\n');
    expect(readSection(content, 'problem')).toBe('Other\n');
  });

  it('handles empty content', () => {
    expect(readSection('', 'Problem')).toBeNull();
    expect(readSection('')).toBe('');
  });

  it('ignores ## inside tilde-fenced code blocks', () => {
    const content = '## Problem\nText\n~~~\n## Fake\n~~~\nMore\n## Approach\nFix\n';
    expect(readSection(content, 'Problem')).toBe('Text\n~~~\n## Fake\n~~~\nMore\n');
  });

  it('returns first match when multiple sections share the same name', () => {
    const content = '## Problem\nFirst\n## Approach\nMiddle\n## Problem\nSecond\n';
    expect(readSection(content, 'Problem')).toBe('First\n');
  });

  it('does not detect ### headings as sections', () => {
    const content = '## Problem\nText\n### Sub\nDetail\n';
    expect(readSection(content, 'Sub')).toBeNull();
  });
});

describe('writeSection', () => {
  it('replaces existing section content', () => {
    const content = '## Problem\nOld text\n## Approach\nFix\n';
    const result = writeSection(content, 'Problem', 'New text\n');
    expect(result).toBe('## Problem\nNew text\n## Approach\nFix\n');
  });

  it('replaces last section content', () => {
    const content = '## Problem\nText\n## Approach\nOld fix\n';
    const result = writeSection(content, 'Approach', 'New fix\n');
    expect(result).toBe('## Problem\nText\n## Approach\nNew fix\n');
  });

  it('appends new section when it does not exist', () => {
    const content = '## Problem\nText\n';
    const result = writeSection(content, 'Approach', 'Fix it\n');
    expect(result).toBe('## Problem\nText\n\n## Approach\nFix it\n');
  });

  it('preserves subheadings in other sections', () => {
    const content = '## Problem\nText\n### Sub\nDetails\n## Approach\nFix\n';
    const result = writeSection(content, 'Approach', 'Better fix\n');
    expect(result).toBe('## Problem\nText\n### Sub\nDetails\n## Approach\nBetter fix\n');
  });

  it('preserves content before first section', () => {
    const content = '# Title\n\nPreamble\n\n## Problem\nOld\n## Approach\nFix\n';
    const result = writeSection(content, 'Problem', 'New\n');
    expect(result).toBe('# Title\n\nPreamble\n\n## Problem\nNew\n## Approach\nFix\n');
  });

  it('handles writing to empty section', () => {
    const content = '## Problem\n## Approach\nFix\n';
    const result = writeSection(content, 'Problem', 'Now has content\n');
    expect(result).toBe('## Problem\nNow has content\n## Approach\nFix\n');
  });

  it('ignores ## inside fenced code blocks when finding boundaries', () => {
    const content = '## Problem\nText\n```\n## Fake\n```\nMore\n## Approach\nFix\n';
    const result = writeSection(content, 'Problem', 'Replaced\n');
    expect(result).toBe('## Problem\nReplaced\n## Approach\nFix\n');
  });

  it('appends to empty content', () => {
    const result = writeSection('', 'Problem', 'New text\n');
    expect(result).toBe('\n## Problem\nNew text\n');
  });

  it('handles content with subheadings in new content', () => {
    const content = '## Problem\nOld\n## Approach\nFix\n';
    const result = writeSection(content, 'Problem', 'New\n### Details\nSub content\n');
    expect(result).toBe('## Problem\nNew\n### Details\nSub content\n## Approach\nFix\n');
  });

  it('clears section content when writing empty string', () => {
    const content = '## Problem\nOld text\n## Approach\nFix\n';
    const result = writeSection(content, 'Problem', '');
    expect(result).toBe('## Problem\n## Approach\nFix\n');
  });

  it('ignores ## inside tilde-fenced code blocks when replacing', () => {
    const content = '## Problem\nText\n~~~\n## Fake\n~~~\nMore\n## Approach\nFix\n';
    const result = writeSection(content, 'Problem', 'New\n');
    expect(result).toBe('## Problem\nNew\n## Approach\nFix\n');
  });

  it('handles content that ends without trailing newline', () => {
    const content = '## Problem\nText';
    const result = writeSection(content, 'Approach', 'Fix\n');
    expect(result).toBe('## Problem\nText\n\n## Approach\nFix\n');
  });
});

// --- Plan-aware Trellis.writeSection / Trellis.readSection ---

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
