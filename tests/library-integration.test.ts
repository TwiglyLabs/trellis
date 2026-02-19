import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfig,
  scanPlans,
  buildGraph,
  detectCycles,
  topologicalSort,
  pickNext,
  computeChunks,
  computeCriticalPath,
  transitiveDependents,
  validateFrontmatter,
  filterPlans,
  newlyReady,
  VALID_STATUSES,
} from '../src/index.ts';

describe('library API integration', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `trellis-lib-test-${Date.now()}`);
    plansDir = join(tmpDir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePlan(id: string, frontmatter: Record<string, unknown>) {
    const fm = Object.entries(frontmatter)
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - ${i}`).join('\n')}`;
        return `${k}: ${v}`;
      })
      .join('\n');
    const planDir = join(plansDir, id);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, 'README.md'), `---\n${fm}\n---\n\nPlan body for ${id}\n`);
  }

  it('loads config from directory', () => {
    const config = loadConfig(tmpDir);
    expect(config.project).toBe('test-project');
    expect(config.plans_dir).toBe('plans');
  });

  it('scans plans and builds graph', () => {
    writePlan('foundation', { title: 'Foundation', status: 'done' });
    writePlan('feature-a', { title: 'Feature A', status: 'not_started', depends_on: ['foundation'] });
    writePlan('feature-b', { title: 'Feature B', status: 'not_started', depends_on: ['foundation'] });

    const plans = scanPlans(plansDir);
    expect(plans).toHaveLength(3);

    const graph = buildGraph(plans);
    expect(graph.ready.has('feature-a')).toBe(true);
    expect(graph.ready.has('feature-b')).toBe(true);
    expect(graph.blocked.size).toBe(0);
  });

  it('computes critical path', () => {
    writePlan('a', { title: 'A', status: 'done' });
    writePlan('b', { title: 'B', status: 'done', depends_on: ['a'] });
    writePlan('c', { title: 'C', status: 'not_started', depends_on: ['b'] });

    const plans = scanPlans(plansDir);
    const graph = buildGraph(plans);
    const path = computeCriticalPath('c', graph);
    expect(path).toEqual(['a', 'b', 'c']);
  });

  it('picks next plan', () => {
    writePlan('a', { title: 'A', status: 'not_started' });
    writePlan('b', { title: 'B', status: 'not_started' });

    const plans = scanPlans(plansDir);
    const graph = buildGraph(plans);
    const next = pickNext(graph);
    expect(next).toBeTruthy();
    expect(['a', 'b']).toContain(next);
  });

  it('detects newly ready plans', () => {
    writePlan('dep', { title: 'Dep', status: 'not_started' });
    writePlan('child', { title: 'Child', status: 'not_started', depends_on: ['dep'] });

    const plans = scanPlans(plansDir);
    const graph = buildGraph(plans);

    const ready = newlyReady('dep', 'done', graph);
    expect(ready).toEqual(['child']);
  });

  it('filters plans by tag and repo', () => {
    writePlan('tagged', { title: 'Tagged', status: 'not_started', tags: ['core'], repo: 'public' });
    writePlan('other', { title: 'Other', status: 'not_started', tags: ['extra'], repo: 'private' });

    const plans = scanPlans(plansDir);
    expect(filterPlans(plans, { tag: 'core' })).toHaveLength(1);
    expect(filterPlans(plans, { repo: 'public' })).toHaveLength(1);
    expect(filterPlans(plans, { tag: 'core', repo: 'public' })).toHaveLength(1);
    expect(filterPlans(plans, { tag: 'core', repo: 'private' })).toHaveLength(0);
  });

  it('computes chunks', () => {
    writePlan('contracts/types', { title: 'Types', status: 'done' });
    writePlan('contracts/api', { title: 'API', status: 'not_started', depends_on: ['contracts/types'] });
    writePlan('impl/core', { title: 'Core', status: 'not_started', depends_on: ['contracts/types'] });

    const plans = scanPlans(plansDir);
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    expect(result.chunks.length).toBeGreaterThan(0);
  });
});
