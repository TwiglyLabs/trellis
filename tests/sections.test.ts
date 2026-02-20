import { describe, it, expect } from 'vitest';
import { readSection, writeSection } from '../src/core/schema.ts';

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
