import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createFixture } from '../helpers.ts';
import { updateCommand } from '../../src/commands/update.ts';

describe('update command', () => {
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

  it('updates plan status', () => {
    const { root, plansDir } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);
    process.cwd = () => root;

    updateCommand('a', 'in_progress', { force: true });

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain('status: in_progress');
    expect(content).toContain('started_at');
  });

  it('sets completed_at when done', async () => {
    const { root, plansDir } = createFixture([
      { id: 'a', title: 'Plan A', status: 'in_progress' },
    ]);
    process.cwd = () => root;

    await updateCommand('a', 'done', { force: true, yes: true });

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain('status: done');
    expect(content).toContain('completed_at');
  });

  it('shows newly ready plans', async () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    await updateCommand('a', 'done', { force: true, yes: true });

    const output = logs.join('\n');
    expect(output).toContain('Now ready');
    expect(output).toContain('b');
  });

  it('rejects invalid status', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);
    process.cwd = () => root;

    updateCommand('a', 'invalid');

    expect(errors.join('\n')).toContain('Invalid status');
  });

  it('rejects missing plan', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    updateCommand('nonexistent', 'done');

    expect(errors.join('\n')).toContain('not found');
  });

  it('warns on backward transition', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'in_progress', started_at: '2026-02-11T10:00:00Z' },
    ]);
    process.cwd = () => root;

    updateCommand('a', 'not_started', { force: true });

    const output = logs.join('\n');
    expect(output).toContain('backward');
  });

  it('clears started_at on backward past in_progress', () => {
    const { root, plansDir } = createFixture([
      { id: 'a', title: 'Plan A', status: 'in_progress', started_at: '2026-02-11T10:00:00Z' },
    ]);
    process.cwd = () => root;

    updateCommand('a', 'not_started', { force: true });

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain('status: not_started');
    // started_at should be cleared, but not_started_at should be set
    expect(content).not.toMatch(/^started_at:/m);
    expect(content).toContain('not_started_at');
  });

  it('outputs JSON on success', async () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    await updateCommand('a', 'done', { json: true, force: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.id).toBe('a');
    expect(parsed.previous_status).toBe('not_started');
    expect(parsed.status).toBe('done');
    expect(parsed.newly_ready).toEqual(['b']);
  });

  it('outputs JSON error on invalid status', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);
    process.cwd = () => root;

    updateCommand('a', 'invalid', { json: true });

    const parsed = JSON.parse(errors.join(''));
    expect(parsed.error).toContain('Invalid status');
  });

  it('outputs JSON error on missing plan', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    updateCommand('nonexistent', 'done', { json: true });

    const parsed = JSON.parse(errors.join(''));
    expect(parsed.error).toContain('not found');
  });

  it('clears completed_at on backward past done', () => {
    const { root, plansDir } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', started_at: '2026-02-11T10:00:00Z', completed_at: '2026-02-12T15:30:00Z' },
    ]);
    process.cwd = () => root;

    updateCommand('a', 'in_progress', { force: true });

    const content = readFileSync(join(plansDir, 'a', 'README.md'), 'utf8');
    expect(content).toContain('status: in_progress');
    expect(content).not.toContain('completed_at');
    // started_at should be preserved since we're still at/past in_progress
    expect(content).toContain('started_at');
  });
});
