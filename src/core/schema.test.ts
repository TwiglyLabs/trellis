import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { detectSections, validateStatusGate } from './schema.ts';
import { createFixture } from '../__tests__/helpers.ts';
import { createContext } from './index.ts';
import { computeUpdate } from '../features/update/logic.ts';
import { computeShow } from '../features/show/logic.ts';
import { updateCommand } from '../features/update/command.ts';

describe('detectSections', () => {
  it('extracts ## headings', () => {
    const content = '## Problem\nSome text\n## Approach\nMore text\n';
    expect(detectSections(content)).toEqual(['Problem', 'Approach']);
  });

  it('returns empty array for no headings', () => {
    expect(detectSections('')).toEqual([]);
    expect(detectSections('Just text\nNo headings\n')).toEqual([]);
  });

  it('ignores headings inside fenced code blocks', () => {
    const content = '## Real\n```\n## Fake\n```\n## Also Real\n';
    expect(detectSections(content)).toEqual(['Real', 'Also Real']);
  });

  it('ignores headings inside tilde code blocks', () => {
    const content = '## Before\n~~~\n## Inside\n~~~\n## After\n';
    expect(detectSections(content)).toEqual(['Before', 'After']);
  });

  it('handles nested headings (only ## level)', () => {
    const content = '# Top\n## Section\n### Sub\n## Another\n';
    expect(detectSections(content)).toEqual(['Section', 'Another']);
  });

  it('trims heading text', () => {
    const content = '##   Spaced Out   \n';
    expect(detectSections(content)).toEqual(['Spaced Out']);
  });

  it('handles frontmatter + content', () => {
    const content = '---\ntitle: Test\n---\n\n## Problem\nText\n## Approach\nMore text\n';
    expect(detectSections(content)).toEqual(['Problem', 'Approach']);
  });
});

describe('validateStatusGate', () => {
  it('draft gate: passes with Problem heading in README', () => {
    const { root, plansDir } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nSomething broken\n' },
    ]);
    const ctx = createContext(root);
    const result = validateStatusGate(ctx.plans[0], 'draft');
    expect(result.pass).toBe(true);
  });

  it('draft gate: fails without Problem heading', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Random\nNo problem here\n' },
    ]);
    const ctx = createContext(root);
    const result = validateStatusGate(ctx.plans[0], 'draft');
    expect(result.pass).toBe(false);
    expect(result.missing).toContain('README.md: missing "## Problem"');
  });

  it('not_started gate: requires implementation.md with Steps, Testing, Done-when', () => {
    const { root } = createFixture([
      {
        id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\nBroken\n## Approach\nFix it\n',
      },
    ]);
    const ctx = createContext(root);
    const result = validateStatusGate(ctx.plans[0], 'not_started');
    expect(result.pass).toBe(false);
    expect(result.missing.some(m => m.includes('implementation.md'))).toBe(true);
  });

  it('not_started gate: passes with complete structure', () => {
    const { root } = createFixture([
      {
        id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\nBroken\n## Approach\nFix it\n',
        implementationMd: '# Implementation\n\n## Steps\n1. Do thing\n\n## Testing\nUnit tests\n\n## Done-when\nAll green\n',
      },
    ]);
    const ctx = createContext(root);
    const result = validateStatusGate(ctx.plans[0], 'not_started');
    expect(result.pass).toBe(true);
  });

  it('done gate: requires outputs.md when plan has dependents', () => {
    const { root } = createFixture([
      {
        id: 'upstream', title: 'Upstream', status: 'in_progress',
        body: '\n## Problem\nNeed this\n## Approach\nBuild it\n',
        implementationMd: '## Steps\n1. Build\n\n## Testing\nTest\n\n## Done-when\nDone\n',
      },
      { id: 'downstream', title: 'Downstream', status: 'not_started', depends_on: ['upstream'] },
    ]);
    const ctx = createContext(root);
    const upstream = ctx.plans.find(p => p.id === 'upstream');
    const result = validateStatusGate(upstream!, 'done', true);
    expect(result.pass).toBe(false);
    expect(result.missing.some(m => m.includes('outputs.md'))).toBe(true);
  });

  it('done gate: passes with outputs.md when plan has dependents', () => {
    const { root } = createFixture([
      {
        id: 'upstream', title: 'Upstream', status: 'in_progress',
        body: '\n## Problem\nNeed this\n## Approach\nBuild it\n',
        implementationMd: '## Steps\n1. Build\n\n## Testing\nTest\n\n## Done-when\nDone\n',
        outputsMd: '## Deliverables\n- Thing 1\n',
      },
      { id: 'downstream', title: 'Downstream', status: 'not_started', depends_on: ['upstream'] },
    ]);
    const ctx = createContext(root);
    const upstream = ctx.plans.find(p => p.id === 'upstream');
    const result = validateStatusGate(upstream!, 'done', true);
    expect(result.pass).toBe(true);
  });

  it('done gate: passes without outputs.md when plan has no dependents', () => {
    const { root } = createFixture([
      {
        id: 'leaf', title: 'Leaf', status: 'in_progress',
        body: '\n## Problem\nFix\n## Approach\nDo\n',
        implementationMd: '## Steps\n1. Go\n\n## Testing\nTest\n\n## Done-when\nDone\n',
      },
    ]);
    const ctx = createContext(root);
    const result = validateStatusGate(ctx.plans[0], 'done', false);
    expect(result.pass).toBe(true);
  });

  it('archived gate: no requirements', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'done', body: '' },
    ]);
    const ctx = createContext(root);
    const result = validateStatusGate(ctx.plans[0], 'archived');
    expect(result.pass).toBe(true);
  });
});

describe('gate enforcement in update', () => {
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

  it('rejects transition when gates are not met', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nBroken\n' },
    ]);
    process.cwd = () => root;

    // Try to move to not_started without implementation.md
    updateCommand('test', 'not_started');

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Cannot transition');
    expect(errors.join('\n')).toContain('implementation.md');
  });

  it('allows transition with --force flag', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nBroken\n' },
    ]);
    process.cwd = () => root;

    updateCommand('test', 'not_started', { force: true });

    expect(process.exitCode).toBeUndefined();
    expect(logs.join('\n')).toContain('test → not_started');
  });

  it('API rejects transition and --force bypasses', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nBroken\n' },
    ]);

    let ctx = createContext(root);
    expect(() => computeUpdate({ planId: 'test', status: 'not_started', graph: ctx.graph }, { refresh: () => {} })).toThrow('Cannot transition');

    ctx = createContext(root);
    const result = computeUpdate({ planId: 'test', status: 'not_started', graph: ctx.graph, force: true }, { refresh: () => {} });
    expect(result.newStatus).toBe('not_started');
  });

  it('allows transition when gates are met', () => {
    const { root } = createFixture([
      {
        id: 'test', title: 'Test', status: 'draft',
        body: '\n## Problem\nBroken\n## Approach\nFix it\n',
        implementationMd: '## Steps\n1. Do thing\n\n## Testing\nUnit tests\n\n## Done-when\nAll green\n',
      },
    ]);
    process.cwd = () => root;

    updateCommand('test', 'not_started');

    expect(process.exitCode).toBeUndefined();
    expect(logs.join('\n')).toContain('test → not_started');
  });
});
