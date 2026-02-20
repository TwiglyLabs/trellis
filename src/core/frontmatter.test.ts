import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseFrontmatter, validateFrontmatter, readPlanFile, updatePlanFile } from './frontmatter.ts';

describe('parseFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const content = `---
title: Test Plan
status: not_started
depends_on:
  - core-types
tags: [foundation]
---

# Plan body

Some content here.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.title).toBe('Test Plan');
    expect(result!.frontmatter.status).toBe('not_started');
    expect(result!.frontmatter.depends_on).toEqual(['core-types']);
    expect(result!.frontmatter.tags).toEqual(['foundation']);
    expect(result!.body).toContain('# Plan body');
  });

  it('returns null for files without title', () => {
    const content = `---
status: draft
---
No title here.
`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  it('returns null for files without frontmatter', () => {
    const content = `# Just a markdown file

No frontmatter at all.
`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  it('handles optional fields', () => {
    const content = `---
title: Minimal Plan
status: draft
---
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.depends_on).toBeUndefined();
    expect(result!.frontmatter.tags).toBeUndefined();
    expect(result!.frontmatter.repo).toBeUndefined();
  });

  it('returns null for missing status', () => {
    const content = `---
title: No Status Plan
---
Body.
`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  it('returns null for invalid status', () => {
    const content = `---
title: Bad Status Plan
status: invalid_value
---
Body.
`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  it('returns null for corrupt YAML', () => {
    const content = `---
title: [broken
status: {{{
---
Body.
`;
    expect(parseFrontmatter(content)).toBeNull();
  });
});

describe('validateFrontmatter', () => {
  it('accepts valid frontmatter', () => {
    const errors = validateFrontmatter('test', {
      title: 'Test',
      status: 'not_started',
      depends_on: ['a'],
      tags: ['b'],
    });
    expect(errors).toEqual([]);
  });

  it('rejects missing title', () => {
    const errors = validateFrontmatter('test', {
      title: '',
      status: 'draft',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('title');
  });

  it('rejects missing status', () => {
    const errors = validateFrontmatter('test', {
      title: 'Test',
      status: '' as any,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('status');
  });

  it('rejects invalid status', () => {
    const errors = validateFrontmatter('test', {
      title: 'Test',
      status: 'invalid' as any,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('status');
    expect(errors[0].message).toContain('invalid');
  });

  it('rejects non-array depends_on', () => {
    const errors = validateFrontmatter('test', {
      title: 'Test',
      status: 'draft',
      depends_on: 'not-an-array' as any,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('depends_on');
  });
});

describe('readPlanFile', () => {
  it('reads and parses a plan file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const filePath = join(dir, 'plan.md');
    writeFileSync(filePath, `---
title: File Plan
status: in_progress
---
Body content.
`);
    const result = readPlanFile(filePath);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.title).toBe('File Plan');
    expect(result!.frontmatter.status).toBe('in_progress');
  });
});

describe('updatePlanFile', () => {
  it('updates frontmatter and preserves body', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const filePath = join(dir, 'plan.md');
    writeFileSync(filePath, `---
title: Original Title
status: not_started
---

# Body

This should be preserved.
`);

    updatePlanFile(filePath, { status: 'in_progress', started_at: '2026-02-11T10:00:00Z' });

    const updated = readFileSync(filePath, 'utf8');
    expect(updated).toContain('status: in_progress');
    expect(updated).toContain('started_at');
    expect(updated).toContain('This should be preserved.');
    expect(updated).toContain('title: Original Title');
  });

  it('round-trips without losing data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const filePath = join(dir, 'plan.md');
    const original = `---
title: Round Trip
status: draft
depends_on:
  - a
  - b
tags:
  - tag1
  - tag2
repo: public
description: A test plan
---

# Content

Detailed plan content here.
`;
    writeFileSync(filePath, original);
    updatePlanFile(filePath, { status: 'not_started' });

    const result = readPlanFile(filePath);
    expect(result!.frontmatter.title).toBe('Round Trip');
    expect(result!.frontmatter.status).toBe('not_started');
    expect(result!.frontmatter.depends_on).toEqual(['a', 'b']);
    expect(result!.frontmatter.tags).toEqual(['tag1', 'tag2']);
    expect(result!.body).toContain('Detailed plan content here.');
  });

  it('throws on corrupt YAML', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const filePath = join(dir, 'plan.md');
    writeFileSync(filePath, `---
*invalid_alias
---
Body.
`);

    expect(() => updatePlanFile(filePath, { status: 'done' })).toThrow('invalid YAML frontmatter');
  });

  it('deletes fields when deleteFields is provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const filePath = join(dir, 'plan.md');
    writeFileSync(filePath, `---
title: Test
status: in_progress
started_at: '2026-02-11T10:00:00Z'
completed_at: '2026-02-12T15:30:00Z'
---
Body.
`);

    updatePlanFile(filePath, { status: 'draft' }, ['started_at', 'completed_at']);

    const updated = readFileSync(filePath, 'utf8');
    expect(updated).toContain('status: draft');
    expect(updated).not.toContain('started_at');
    expect(updated).not.toContain('completed_at');
  });
});
