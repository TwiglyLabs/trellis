import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { readSection, writeSection } from '../../core/schema.ts';
import { createContext } from '../../core/index.ts';
import { computeWriteSection, computeReadSection, computeWriteSections } from './logic.ts';
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

  it('adds trailing newline when replacing content without one', () => {
    const content = '## Problem\nOld text\n## Approach\nFix\n';
    const result = writeSection(content, 'Problem', 'New text');
    expect(result).toBe('## Problem\nNew text\n## Approach\nFix\n');
  });

  it('adds trailing newline when replacing last section without one', () => {
    const content = '## Problem\nText\n## Approach\nOld fix\n';
    const result = writeSection(content, 'Approach', 'New fix');
    expect(result).toBe('## Problem\nText\n## Approach\nNew fix\n');
  });

  it('adds trailing newline when appending section without one', () => {
    const content = '## Problem\nText\n';
    const result = writeSection(content, 'Approach', 'Fix it');
    expect(result).toBe('## Problem\nText\n\n## Approach\nFix it\n');
  });
});

// --- Plan-aware computeWriteSection / computeReadSection ---

describe('computeWriteSection', () => {
  it('writes content to a section in readme', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nOld text\n## Approach\nOld approach\n' },
    ]);
    const ctx = createContext(root);
    const result = computeWriteSection({ planId: 'test', file: 'readme', section: 'Problem', content: 'New problem text\n', graph: ctx.graph });

    expect(result.content).toContain('New problem text');

    const content = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    expect(content).toContain('New problem text');
    expect(content).toContain('## Approach');
  });

  it('creates missing optional files (outputs)', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    computeWriteSection({ planId: 'test', file: 'outputs', section: 'Deliverables', content: '- API endpoint\n', graph: ctx.graph });

    expect(existsSync(join(root, 'plans', 'test', 'outputs.md'))).toBe(true);
    const content = readFileSync(join(root, 'plans', 'test', 'outputs.md'), 'utf8');
    expect(content).toContain('## Deliverables');
    expect(content).toContain('- API endpoint');
  });

  it('appends section when it does not exist', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    computeWriteSection({ planId: 'test', file: 'readme', section: 'Approach', content: 'New approach\n', graph: ctx.graph });

    const content = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    expect(content).toContain('## Problem');
    expect(content).toContain('## Approach');
    expect(content).toContain('New approach');
  });

  it('rejects unknown plan', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);
    expect(() => computeWriteSection({ planId: 'nonexistent', file: 'readme', section: 'Problem', content: 'text', graph: ctx.graph })).toThrow('not found');
  });

  it('rejects invalid file name', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeWriteSection({ planId: 'test', file: 'invalid' as any, section: 'Problem', content: 'text', graph: ctx.graph })).toThrow('invalid');
  });

  it('writes to implementation file that already exists', () => {
    const { root } = createFixture([
      {
        id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\nText\n',
        implementationMd: '## Steps\n1. Do thing\n\n## Testing\nTest it\n\n## Done-when\nAll done\n',
      },
    ]);
    const ctx = createContext(root);
    computeWriteSection({ planId: 'test', file: 'implementation', section: 'Steps', content: '1. Updated step\n', graph: ctx.graph });

    const content = readFileSync(join(root, 'plans', 'test', 'implementation.md'), 'utf8');
    expect(content).toContain('1. Updated step');
    expect(content).toContain('## Testing');
    expect(content).toContain('## Done-when');
  });

  it('creates implementation file when it does not exist', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    const result = computeWriteSection({ planId: 'test', file: 'implementation', section: 'Steps', content: '1. Step\n', graph: ctx.graph });
    expect(result.section).toBe('Steps');
    const content = readFileSync(join(root, 'plans', 'test', 'implementation.md'), 'utf8');
    expect(content).toContain('1. Step');
  });
});

describe('computeReadSection', () => {
  it('reads full plan when no file/section specified', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    const result = computeReadSection({ planId: 'test', graph: ctx.graph });

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
    const ctx = createContext(root);
    const result = computeReadSection({ planId: 'test', file: 'implementation', graph: ctx.graph });

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
    const ctx = createContext(root);
    const result = computeReadSection({ planId: 'test', file: 'readme', section: 'Problem', graph: ctx.graph });

    expect(result.content).toBe('Broken\n');
  });

  it('returns null content for missing section', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeReadSection({ planId: 'test', file: 'readme', section: 'NonExistent', graph: ctx.graph })).toThrow('not found');
  });

  it('rejects unknown plan', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);
    expect(() => computeReadSection({ planId: 'nonexistent', graph: ctx.graph })).toThrow('not found');
  });

  it('rejects missing file', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    expect(() => computeReadSection({ planId: 'test', file: 'outputs', graph: ctx.graph })).toThrow('does not exist');
  });

  it('readSection with no file strips README frontmatter', () => {
    const { root } = createFixture([
      { id: 'test', title: 'My Test Plan', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);
    const result = computeReadSection({ planId: 'test', graph: ctx.graph });

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
    const ctx = createContext(root);
    const result = computeReadSection({ planId: 'test', graph: ctx.graph });

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
    const ctx = createContext(root);
    computeWriteSection({ planId: 'test', file: 'readme', section: 'Problem', content: 'New content\n', graph: ctx.graph });

    const content = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    const parsed = matter(content);
    expect(parsed.data.title).toBe('Original Title');
    expect(parsed.data.status).toBe('draft');
    expect(parsed.data.tags).toContain('foo');
    expect(content).toContain('New content');
  });
});

// --- Batch computeWriteSections ---

describe('computeWriteSections', () => {
  it('writes multiple sections to readme in one pass', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\n\n\n## Approach\n\n\n' },
    ]);
    const ctx = createContext(root);

    const result = computeWriteSections(
      {
        planId: 'test',
        writes: [
          { file: 'readme', section: 'Problem', content: 'New problem' },
          { file: 'readme', section: 'Approach', content: 'New approach' },
        ],
        graph: ctx.graph,
      },
    );

    expect(result.id).toBe('test');
    expect(result.writes).toHaveLength(2);

    const content = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    expect(content).toContain('New problem');
    expect(content).toContain('New approach');
  });

  it('writes to multiple files in one call', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\nOld\n',
        implementationMd: '## Steps\nOld\n' },
    ]);
    const ctx = createContext(root);

    const result = computeWriteSections(
      {
        planId: 'test',
        writes: [
          { file: 'readme', section: 'Problem', content: 'New problem' },
          { file: 'implementation', section: 'Steps', content: 'New steps' },
        ],
        graph: ctx.graph,
      },
    );

    expect(result.writes).toHaveLength(2);

    const readme = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
    expect(readme).toContain('New problem');

    const impl = readFileSync(join(root, 'plans', 'test', 'implementation.md'), 'utf8');
    expect(impl).toContain('New steps');
  });

  it('auto-creates inputs and outputs files', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '' },
    ]);
    const ctx = createContext(root);

    computeWriteSections(
      {
        planId: 'test',
        writes: [
          { file: 'inputs', section: 'From plans', content: 'Some input' },
          { file: 'outputs', section: 'Deliverables', content: 'Some output' },
        ],
        graph: ctx.graph,
      },
    );

    const inputs = readFileSync(join(root, 'plans', 'test', 'inputs.md'), 'utf8');
    expect(inputs).toContain('Some input');

    const outputs = readFileSync(join(root, 'plans', 'test', 'outputs.md'), 'utf8');
    expect(outputs).toContain('Some output');
  });

  it('creates implementation file when it does not exist', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '' },
    ]);
    const ctx = createContext(root);

    const result = computeWriteSections(
      {
        planId: 'test',
        writes: [{ file: 'implementation', section: 'Steps', content: 'stuff' }],
        graph: ctx.graph,
      },
    );
    expect(result.writes).toHaveLength(1);
    const content = readFileSync(join(root, 'plans', 'test', 'implementation.md'), 'utf8');
    expect(content).toContain('stuff');
  });

  it('throws for invalid file name', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '' },
    ]);
    const ctx = createContext(root);

    expect(() =>
      computeWriteSections(
        {
          planId: 'test',
          writes: [{ file: 'bogus', section: 'X', content: 'Y' }],
          graph: ctx.graph,
        },
      ),
    ).toThrow(/Invalid file/);
  });

  it('throws for unknown plan', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);

    expect(() =>
      computeWriteSections(
        {
          planId: 'nope',
          writes: [{ file: 'readme', section: 'Problem', content: 'X' }],
          graph: ctx.graph,
        },
      ),
    ).toThrow(/not found/);
  });
});
