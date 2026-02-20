import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createContext, refreshContext } from './context.ts';
import { createFixture } from '../__tests__/helpers.ts';

describe('createContext', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('builds a full context from project directory', () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    root = fixture.root;

    const ctx = createContext(root);

    expect(ctx.projectDir).toBe(root);
    expect(ctx.config.project).toBe('test-project');
    expect(ctx.plansDir).toBe(join(root, 'plans'));
    expect(ctx.plans).toHaveLength(2);
    expect(ctx.graph.plans.size).toBe(2);
    expect(ctx.graph.ready.has('b')).toBe(true);
  });

  it('detects blocked plans', () => {
    const fixture = createFixture([
      { id: 'dep', title: 'Dep', status: 'not_started' },
      { id: 'child', title: 'Child', status: 'not_started', depends_on: ['dep'] },
    ]);
    root = fixture.root;

    const ctx = createContext(root);

    expect(ctx.graph.blocked.has('child')).toBe(true);
    expect(ctx.graph.ready.has('dep')).toBe(true);
  });

  it('returns default config when .trellis is missing', () => {
    const { mkdtempSync } = require('fs');
    const { tmpdir } = require('os');
    root = mkdtempSync(join(tmpdir(), 'trellis-ctx-'));
    mkdirSync(join(root, 'plans'), { recursive: true });

    const ctx = createContext(root);
    expect(ctx.config.plans_dir).toBe('plans');
    expect(ctx.plans).toHaveLength(0);
  });
});

describe('refreshContext', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('picks up new plans added after initial scan', () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
    ]);
    root = fixture.root;

    const ctx = createContext(root);
    expect(ctx.plans).toHaveLength(1);

    // Add a new plan on disk
    const newDir = join(fixture.plansDir, 'b');
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(newDir, 'README.md'), '---\ntitle: Plan B\nstatus: not_started\ndepends_on:\n  - a\n---\n\n## Problem\n\n');

    const refreshed = refreshContext(ctx);

    expect(refreshed.plans).toHaveLength(2);
    expect(refreshed.graph.plans.has('b')).toBe(true);
    expect(refreshed.graph.ready.has('b')).toBe(true);
  });

  it('preserves config and projectDir from original context', () => {
    const fixture = createFixture([
      { id: 'x', title: 'X', status: 'not_started' },
    ]);
    root = fixture.root;

    const ctx = createContext(root);
    const refreshed = refreshContext(ctx);

    expect(refreshed.projectDir).toBe(ctx.projectDir);
    expect(refreshed.config).toBe(ctx.config);
    expect(refreshed.plansDir).toBe(ctx.plansDir);
  });

  it('reflects status changes on disk', () => {
    const fixture = createFixture([
      { id: 'dep', title: 'Dep', status: 'not_started' },
      { id: 'child', title: 'Child', status: 'not_started', depends_on: ['dep'] },
    ]);
    root = fixture.root;

    const ctx = createContext(root);
    expect(ctx.graph.blocked.has('child')).toBe(true);

    // Manually update dep to done on disk
    writeFileSync(
      join(fixture.plansDir, 'dep', 'README.md'),
      '---\ntitle: Dep\nstatus: done\n---\n\n## Problem\n\n',
    );

    const refreshed = refreshContext(ctx);
    expect(refreshed.graph.blocked.has('child')).toBe(false);
    expect(refreshed.graph.ready.has('child')).toBe(true);
  });
});
