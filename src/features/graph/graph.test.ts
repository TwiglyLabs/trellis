import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture } from '../../__tests__/helpers.ts';
import { graphCommand } from './command.ts';

describe('graph command', () => {
  let originalCwd: () => string;
  let logs: string[];

  beforeEach(() => {
    originalCwd = process.cwd;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logs.push(args.join(' '));
    });
  });

  afterEach(() => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
  });

  it('shows message when no plans found', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    graphCommand({});

    expect(logs.join('\n')).toContain('No plans found');
  });

  it('outputs JSON DAG', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], tags: ['infra'] },
      { id: 'c', title: 'Plan C', status: 'not_started', depends_on: ['b'] },
    ]);
    process.cwd = () => root;

    graphCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.nodes).toHaveLength(3);
    expect(parsed.edges).toHaveLength(2);

    const nodeB = parsed.nodes.find((n: any) => n.id === 'b');
    expect(nodeB.title).toBe('Plan B');
    expect(nodeB.status).toBe('not_started');
    expect(nodeB.blocked).toBe(false);
    expect(nodeB.ready).toBe(true);
    expect(nodeB.tags).toEqual(['infra']);

    expect(parsed.edges).toContainEqual({ from: 'a', to: 'b' });
    expect(parsed.edges).toContainEqual({ from: 'b', to: 'c' });
  });

  it('outputs empty JSON DAG when no plans', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    graphCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.nodes).toEqual([]);
    expect(parsed.edges).toEqual([]);
  });

  it('shows text summary with plan and edge counts', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    graphCommand({});

    const output = logs.join('\n');
    expect(output).toContain('2 plans, 1 edge');
  });

  it('shows ready plans', () => {
    const { root } = createFixture([
      { id: 'auth', title: 'Auth', status: 'done' },
      { id: 'api', title: 'API', status: 'not_started', depends_on: ['auth'] },
      { id: 'docs', title: 'Docs', status: 'not_started' },
    ]);
    process.cwd = () => root;

    graphCommand({});

    const output = logs.join('\n');
    expect(output).toContain('Ready: api, docs');
  });

  it('shows blocked plans with reasons', () => {
    const { root } = createFixture([
      { id: 'core', title: 'Core', status: 'not_started' },
      { id: 'auth', title: 'Auth', status: 'not_started', depends_on: ['core'] },
      { id: 'frontend', title: 'Frontend', status: 'not_started', depends_on: ['auth', 'core'] },
    ]);
    process.cwd = () => root;

    graphCommand({});

    const output = logs.join('\n');
    expect(output).toContain('Blocked:');
    expect(output).toContain('auth (by: core)');
    expect(output).toContain('frontend (by: auth, core)');
  });

  it('shows critical path', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'not_started' },
      { id: 'b', title: 'B', status: 'not_started', depends_on: ['a'] },
      { id: 'c', title: 'C', status: 'not_started', depends_on: ['b'] },
    ]);
    process.cwd = () => root;

    graphCommand({});

    const output = logs.join('\n');
    expect(output).toContain('Critical path: a → b → c (3 steps)');
  });

  it('picks longest critical path across multiple leaf nodes', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'not_started' },
      { id: 'b', title: 'B', status: 'not_started', depends_on: ['a'] },
      { id: 'c', title: 'C', status: 'not_started', depends_on: ['b'] },
      { id: 'd', title: 'D', status: 'not_started' },
      { id: 'e', title: 'E', status: 'not_started', depends_on: ['d'] },
    ]);
    process.cwd = () => root;

    graphCommand({});

    const output = logs.join('\n');
    expect(output).toContain('Critical path: a \u2192 b \u2192 c (3 steps)');
  });

  it('omits ready and blocked lines when all plans are done', () => {
    const { root } = createFixture([
      { id: 'a', title: 'A', status: 'done' },
      { id: 'b', title: 'B', status: 'done', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    graphCommand({});

    const output = logs.join('\n');
    expect(output).toContain('2 plans, 1 edge');
    expect(output).not.toContain('Ready:');
    expect(output).not.toContain('Blocked:');
  });

  it('shows zero edges for independent plans', () => {
    const { root } = createFixture([
      { id: 'x', title: 'X', status: 'not_started' },
      { id: 'y', title: 'Y', status: 'not_started' },
      { id: 'z', title: 'Z', status: 'not_started' },
    ]);
    process.cwd = () => root;

    graphCommand({});

    const output = logs.join('\n');
    expect(output).toContain('3 plans, 0 edges');
    expect(output).toContain('Ready: x, y, z');
    expect(output).not.toContain('Blocked:');
  });

  it('omits critical path for single-node graph', () => {
    const { root } = createFixture([
      { id: 'solo', title: 'Solo', status: 'not_started' },
    ]);
    process.cwd = () => root;

    graphCommand({});

    const output = logs.join('\n');
    expect(output).not.toContain('Critical path');
  });
});
