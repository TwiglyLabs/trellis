import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture } from '../helpers.ts';
import http from 'http';

// Mock the HTML viewer import before importing the command
vi.mock('../../src/viewer/index.html', () => ({
  default: '<html>__TRELLIS_DATA__</html>',
}));

// Mock child_process.execFile to prevent opening browser
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { graphCommand } from '../../src/commands/graph.ts';

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

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

  it('serves viewer data with chunks and contracts via /api/data', async () => {
    const { root } = createFixture([
      {
        id: 'core',
        title: 'Core',
        status: 'done',
        directory: true,
        outputsMd: '## Types\n- CoreType\n- OtherType\n',
      },
      {
        id: 'consumer',
        title: 'Consumer',
        status: 'not_started',
        depends_on: ['core'],
        directory: true,
        inputsMd: '## From plans\n### core\n- Needs CoreType\n',
      },
    ]);
    process.cwd = () => root;

    graphCommand({ port: 0 });

    // Wait for server to start (listen callback is async)
    await new Promise(resolve => setTimeout(resolve, 200));

    const portMatch = logs.join('\n').match(/localhost:(\d+)/);
    expect(portMatch).toBeTruthy();
    const port = portMatch![1];

    const data = await fetchJson(`http://localhost:${port}/api/data`);

    // Verify plans include contract raw content
    const corePlan = data.plans.find((p: any) => p.id === 'core');
    expect(corePlan.outputs).toContain('## Types');
    const consumerPlan = data.plans.find((p: any) => p.id === 'consumer');
    expect(consumerPlan.inputs).toContain('### core');

    // Verify chunks are present
    expect(data.chunks).toBeDefined();
    expect(data.chunks.length).toBeGreaterThan(0);

    // Verify crossChunkEdges is present
    expect(data.crossChunkEdges).toBeDefined();

    // Verify HTML contains injected data
    const html = await fetchHtml(`http://localhost:${port}/`);
    expect(html).toContain('"chunks"');
    expect(html).toContain('"crossChunkEdges"');
  });
});
