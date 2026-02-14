import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { epicCommand } from '../../src/commands/epic.ts';
import { createFixture } from '../helpers.ts';

describe('epic command', () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const origCwd = process.cwd;

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
  });

  afterEach(() => {
    process.cwd = origCwd;
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('lists all epics with completion stats', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', tags: ['epic:v1'] },
      { id: 'b', title: 'Plan B', status: 'in_progress', tags: ['epic:v1'] },
      { id: 'c', title: 'Plan C', status: 'not_started', tags: ['epic:v1'] },
      { id: 'd', title: 'Plan D', status: 'done', tags: ['epic:v2'] },
      { id: 'e', title: 'Plan E', status: 'done', tags: ['epic:v2'] },
      { id: 'f', title: 'Plan F', status: 'not_started' },
    ]);
    process.cwd = () => root;

    epicCommand({});

    const output = logs.join('\n');
    expect(output).toContain('v1');
    expect(output).toContain('1/3');
    expect(output).toContain('v2');
    expect(output).toContain('2/2');
  });

  it('shows message when no epics exist', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);
    process.cwd = () => root;

    epicCommand({});

    expect(logs.join('\n')).toContain('No epics found');
  });

  it('shows detail for a single epic', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', tags: ['epic:v1'] },
      { id: 'b', title: 'Plan B', status: 'in_progress', tags: ['epic:v1'] },
      { id: 'c', title: 'Plan C', status: 'not_started', tags: ['epic:v1'], depends_on: ['b'] },
    ]);
    process.cwd = () => root;

    epicCommand({}, 'v1');

    const output = logs.join('\n');
    expect(output).toContain('v1');
    expect(output).toContain('1/3');
    expect(output).toContain('Plan A');
    expect(output).toContain('Plan B');
    expect(output).toContain('Plan C');
  });

  it('shows single epic as JSON', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', tags: ['epic:v1'] },
      { id: 'b', title: 'Plan B', status: 'not_started', tags: ['epic:v1'] },
    ]);
    process.cwd = () => root;

    epicCommand({ json: true }, 'v1');

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.epic).toBe('v1');
    expect(parsed.total).toBe(2);
    expect(parsed.done).toBe(1);
    expect(parsed.plans).toHaveLength(2);
    expect(parsed.plans[0]).toHaveProperty('id');
    expect(parsed.plans[0]).toHaveProperty('status');
  });

  it('shows error for unknown epic', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', tags: ['epic:v1'] },
    ]);
    process.cwd = () => root;

    epicCommand({}, 'nonexistent');

    expect(errors.join('\n')).toContain('not found');
  });

  it('shows JSON error for unknown epic', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', tags: ['epic:v1'] },
    ]);
    process.cwd = () => root;

    epicCommand({ json: true }, 'nonexistent');

    const parsed = JSON.parse(errors.join(''));
    expect(parsed.error).toContain('not found');
  });

  it('lists epics as JSON', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done', tags: ['epic:v1'] },
      { id: 'b', title: 'Plan B', status: 'not_started', tags: ['epic:v1'] },
    ]);
    process.cwd = () => root;

    epicCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].epic).toBe('v1');
    expect(parsed[0].total).toBe(2);
    expect(parsed[0].done).toBe(1);
    expect(parsed[0].progress).toBeCloseTo(0.5);
  });
});
