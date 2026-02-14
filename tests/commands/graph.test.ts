import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture } from '../helpers.ts';

// Mock the HTML viewer import before importing the command
vi.mock('../../src/viewer/index.html', () => ({
  default: '<html>__TRELLIS_DATA__</html>',
}));

import { graphCommand } from '../../src/commands/graph.ts';

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
});
