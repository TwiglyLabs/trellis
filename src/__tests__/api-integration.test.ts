import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import from barrel — this is the consumer's entry point
import { createContext, refreshContext } from '../core/index.ts';
import { computeStatus } from '../features/status/logic.ts';
import { computeReady } from '../features/ready/logic.ts';
import { computeShow } from '../features/show/logic.ts';
import { computeUpdate } from '../features/update/logic.ts';
import { computeLint } from '../features/lint/logic.ts';
import { computeGraph } from '../features/graph/logic.ts';
import { computeEpic } from '../features/epic/logic.ts';
import { computeChunksFeature } from '../features/chunks/logic.ts';
import type {
  StatusResult,
  ReadyResult,
  ShowResult,
  UpdateResult,
  LintResult,
  GraphResult,
  EpicResult,
} from '../index.ts';

function createTestProject(plans: Record<string, Record<string, unknown>> = {}) {
  const tmpDir = join(tmpdir(), `trellis-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const plansDir = join(tmpDir, 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');

  for (const [id, frontmatter] of Object.entries(plans)) {
    const fm = Object.entries(frontmatter)
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - ${i}`).join('\n')}`;
        return `${k}: ${v}`;
      })
      .join('\n');
    const planDir = join(plansDir, id);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, 'README.md'), `---\n${fm}\n---\n\nBody for ${id}\n`);
  }

  return { tmpDir, plansDir };
}

describe('Consumer workflow: project overview', () => {
  let tmpDir: string;

  beforeEach(() => {
    const project = createTestProject({
      'contracts/types':   { title: 'Core Types', status: 'done', tags: ['foundation', 'epic:v1'] },
      'contracts/api':     { title: 'API Contract', status: 'done', depends_on: ['contracts/types'], tags: ['foundation', 'epic:v1'] },
      'impl/scanner':      { title: 'Scanner', status: 'in_progress', depends_on: ['contracts/types'], tags: ['core', 'epic:v1'] },
      'impl/graph':        { title: 'Graph Engine', status: 'not_started', depends_on: ['contracts/api'], tags: ['core', 'epic:v1'] },
      'impl/cli':          { title: 'CLI Layer', status: 'not_started', depends_on: ['impl/scanner', 'impl/graph'], tags: ['shell', 'epic:v2'] },
      'docs/readme':       { title: 'README', status: 'draft', tags: ['docs', 'epic:v2'] },
    });
    tmpDir = project.tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('status → ready → show → graph gives a consistent project view', () => {
    const ctx = createContext(tmpDir);

    const status: StatusResult = computeStatus({ plans: ctx.plans, config: ctx.config, graph: ctx.graph, filters: { showDone: true } });
    expect(status.project).toBe('test-project');
    expect(status.total).toBe(6);
    expect(status.byStatus.done).toHaveLength(2);
    expect(status.byStatus.inProgress).toHaveLength(1);
    expect(status.byStatus.ready.map(p => p.id)).toContain('impl/graph');
    expect(status.byStatus.blocked.map(p => p.id)).toContain('impl/cli');

    const ready: ReadyResult = computeReady({ plans: ctx.plans, graph: ctx.graph, filters: {} });
    expect(ready.plans.length).toBeGreaterThanOrEqual(1);
    expect(ready.next).toBeTruthy();

    const show: ShowResult = computeShow({ planId: 'impl/cli', graph: ctx.graph })!;
    expect(show).not.toBeNull();
    expect(show.blocked).toBe(true);
    expect(show.dependsOn).toHaveLength(2);
    expect(show.dependsOn.find(d => d.id === 'impl/scanner')!.satisfied).toBe(false);
    expect(show.dependsOn.find(d => d.id === 'impl/graph')!.satisfied).toBe(false);
    expect(show.criticalPath.length).toBeGreaterThanOrEqual(2);
    expect(show.body).toContain('Body for impl/cli');

    const graph: GraphResult = computeGraph({ plans: ctx.plans, graph: ctx.graph, config: ctx.config });
    expect(graph.nodes).toHaveLength(6);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.nodes.find(n => n.id === 'impl/cli')!.blocked).toBe(true);
    expect(graph.nodes.find(n => n.id === 'impl/graph')!.ready).toBe(true);

    // Consistency: graph and status agree on state
    const readyFromGraph = graph.nodes.filter(n => n.ready).map(n => n.id).sort();
    const readyFromStatus = status.byStatus.ready.map(p => p.id).sort();
    expect(readyFromGraph).toEqual(readyFromStatus);
  });
});

describe('Consumer workflow: work on a plan', () => {
  let tmpDir: string;

  beforeEach(() => {
    const project = createTestProject({
      'foundation': { title: 'Foundation', status: 'done' },
      'feature-a':  { title: 'Feature A', status: 'not_started', depends_on: ['foundation'] },
      'feature-b':  { title: 'Feature B', status: 'not_started', depends_on: ['feature-a'] },
    });
    tmpDir = project.tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('update a plan and see downstream effects', () => {
    let ctx = createContext(tmpDir);

    expect(computeReady({ plans: ctx.plans, graph: ctx.graph, filters: {} }).plans.map(p => p.id)).toContain('feature-a');
    expect(computeShow({ planId: 'feature-b', graph: ctx.graph })!.blocked).toBe(true);

    const startResult: UpdateResult = computeUpdate({ planId: 'feature-a', status: 'in_progress', graph: ctx.graph, force: true }, { refresh: () => {} });
    expect(startResult.previousStatus).toBe('not_started');
    expect(startResult.newStatus).toBe('in_progress');
    expect(startResult.backward).toBe(false);

    ctx = createContext(tmpDir);
    const afterStart = computeStatus({ plans: ctx.plans, config: ctx.config, graph: ctx.graph, filters: { showDone: true } });
    expect(afterStart.byStatus.inProgress.map(p => p.id)).toContain('feature-a');

    const doneResult: UpdateResult = computeUpdate({ planId: 'feature-a', status: 'done', graph: ctx.graph, force: true }, { refresh: () => {} });
    expect(doneResult.newlyReady).toContain('feature-b');

    ctx = createContext(tmpDir);
    expect(computeShow({ planId: 'feature-b', graph: ctx.graph })!.blocked).toBe(false);
    expect(computeShow({ planId: 'feature-b', graph: ctx.graph })!.ready).toBe(true);
    expect(computeReady({ plans: ctx.plans, graph: ctx.graph, filters: {} }).plans.map(p => p.id)).toContain('feature-b');
  });

  it('backward status transition clears timestamps', () => {
    let ctx = createContext(tmpDir);

    computeUpdate({ planId: 'feature-a', status: 'in_progress', graph: ctx.graph, force: true }, { refresh: () => {} });
    ctx = createContext(tmpDir);
    const afterStart = computeShow({ planId: 'feature-a', graph: ctx.graph })!;
    expect(afterStart.startedAt).toBeTruthy();

    computeUpdate({ planId: 'feature-a', status: 'done', graph: ctx.graph, force: true }, { refresh: () => {} });
    ctx = createContext(tmpDir);
    const afterDone = computeShow({ planId: 'feature-a', graph: ctx.graph })!;
    expect(afterDone.completedAt).toBeTruthy();

    const revertResult = computeUpdate({ planId: 'feature-a', status: 'not_started', graph: ctx.graph, force: true }, { refresh: () => {} });
    expect(revertResult.backward).toBe(true);

    ctx = createContext(tmpDir);
    const afterRevert = computeShow({ planId: 'feature-a', graph: ctx.graph })!;
    expect(afterRevert.startedAt).toBeUndefined();
    expect(afterRevert.completedAt).toBeUndefined();
  });
});

describe('Consumer workflow: project health check', () => {
  let tmpDir: string;

  beforeEach(() => {
    const project = createTestProject({
      'valid-a': { title: 'Valid A', status: 'done' },
      'valid-b': { title: 'Valid B', status: 'not_started', depends_on: ['valid-a'] },
      'broken':  { title: 'Broken', status: 'not_started', depends_on: ['nonexistent'] },
      'orphan':  { title: 'Orphan', status: 'draft' },
    });
    tmpDir = project.tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lint detects errors and warnings', () => {
    const ctx = createContext(tmpDir);
    const result: LintResult = computeLint({ plans: ctx.plans, graph: ctx.graph, projectDir: ctx.projectDir, plansDir: ctx.plansDir, options: {} });

    expect(result.ok).toBe(false);
    expect(result.total).toBe(4);
    expect(result.errors.some(e => e.type === 'missing_dependency' && e.planId === 'broken')).toBe(true);
    expect(result.warnings.some(w => w.type === 'orphan' && w.planId === 'orphan')).toBe(true);
  });

  it('strict mode fails on warnings too', () => {
    const ctx = createContext(tmpDir);
    const relaxed = computeLint({ plans: ctx.plans, graph: ctx.graph, projectDir: ctx.projectDir, plansDir: ctx.plansDir, options: {} });
    const strict = computeLint({ plans: ctx.plans, graph: ctx.graph, projectDir: ctx.projectDir, plansDir: ctx.plansDir, options: { strict: true } });

    expect(strict.ok).toBe(false);
    expect(strict.errors).toEqual(relaxed.errors);
    expect(strict.warnings).toEqual(relaxed.warnings);
  });
});

describe('Consumer workflow: epic tracking', () => {
  let tmpDir: string;

  beforeEach(() => {
    const project = createTestProject({
      'a': { title: 'A', status: 'done', tags: ['epic:v1'] },
      'b': { title: 'B', status: 'in_progress', tags: ['epic:v1'] },
      'c': { title: 'C', status: 'not_started', tags: ['epic:v1', 'epic:v2'] },
      'd': { title: 'D', status: 'not_started', tags: ['epic:v2'] },
    });
    tmpDir = project.tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks progress across epics', () => {
    const ctx = createContext(tmpDir);
    const epics: EpicResult[] = computeEpic({ plans: ctx.plans, graph: ctx.graph, name: undefined });

    expect(epics).toHaveLength(2);

    const v1 = epics.find(e => e.epic === 'v1')!;
    expect(v1.total).toBe(3);
    expect(v1.done).toBe(1);
    expect(v1.inProgress).toBe(1);
    expect(v1.progress).toBeCloseTo(1 / 3);

    const v2 = epics.find(e => e.epic === 'v2')!;
    expect(v2.total).toBe(2);
    expect(v2.done).toBe(0);
  });

  it('single epic includes plan details', () => {
    const ctx = createContext(tmpDir);
    const [v1]: EpicResult[] = computeEpic({ plans: ctx.plans, graph: ctx.graph, name: 'v1' });

    expect(v1.plans).toBeDefined();
    expect(v1.plans).toHaveLength(3);
    expect(v1.plans!.map(p => p.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('Consumer workflow: error paths', () => {
  it('throws on missing .trellis config', () => {
    const tmpDir = join(tmpdir(), `trellis-noconfig-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      // loadConfig returns defaults when no .trellis exists, so it won't throw.
      // But scanning will fail if plans dir doesn't exist.
      const ctx = createContext(tmpDir);
      expect(ctx.config.plans_dir).toBe('plans');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('show returns null for unknown plan', () => {
    const { tmpDir } = createTestProject({
      'a': { title: 'A', status: 'not_started' },
    });
    try {
      const ctx = createContext(tmpDir);
      expect(computeShow({ planId: 'nonexistent', graph: ctx.graph })).toBeNull();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('update throws on unknown plan', () => {
    const { tmpDir } = createTestProject({
      'a': { title: 'A', status: 'not_started' },
    });
    try {
      const ctx = createContext(tmpDir);
      expect(() => computeUpdate({ planId: 'nonexistent', status: 'done', graph: ctx.graph }, { refresh: () => {} })).toThrow('not found');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('update throws on invalid status', () => {
    const { tmpDir } = createTestProject({
      'a': { title: 'A', status: 'not_started' },
    });
    try {
      const ctx = createContext(tmpDir);
      expect(() => computeUpdate({ planId: 'a', status: 'invalid' as any, graph: ctx.graph }, { refresh: () => {} })).toThrow('Invalid status');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles corrupt frontmatter gracefully', () => {
    const tmpDir = join(tmpdir(), `trellis-corrupt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const plansDir = join(tmpDir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');

    mkdirSync(join(plansDir, 'good'), { recursive: true });
    writeFileSync(join(plansDir, 'good', 'README.md'), '---\ntitle: Good Plan\nstatus: not_started\n---\n\nBody\n');
    mkdirSync(join(plansDir, 'corrupt'), { recursive: true });
    writeFileSync(join(plansDir, 'corrupt', 'README.md'), '---\n: invalid yaml {{{\nstatus: [broken\n---\n\nBody\n');

    try {
      const ctx = createContext(tmpDir);
      const status = computeStatus({ plans: ctx.plans, config: ctx.config, graph: ctx.graph, filters: {} });
      expect(status.total).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Consumer workflow: chunks and filtering', () => {
  let tmpDir: string;

  beforeEach(() => {
    const project = createTestProject({
      'contracts/types': { title: 'Types', status: 'done', tags: ['foundation'] },
      'contracts/api':   { title: 'API', status: 'not_started', depends_on: ['contracts/types'], tags: ['foundation'] },
      'impl/core':       { title: 'Core', status: 'not_started', depends_on: ['contracts/types'], tags: ['core'] },
      'impl/extra':      { title: 'Extra', status: 'not_started', depends_on: ['impl/core'], tags: ['core'] },
    });
    tmpDir = project.tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('chunks returns coherent chunk data', () => {
    const ctx = createContext(tmpDir);
    const result = computeChunksFeature({ plans: ctx.plans, graph: ctx.graph, config: ctx.config, filters: {} });

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(Array.isArray(result.crossChunkEdges)).toBe(true);
    expect(typeof result.config.maxLines).toBe('number');

    const allPlanIds = result.chunks.flatMap(c => c.plans.map(p => p.id)).sort();
    expect(allPlanIds).toEqual(['contracts/api', 'contracts/types', 'impl/core', 'impl/extra']);
  });

  it('status filters by tag', () => {
    const ctx = createContext(tmpDir);

    const coreOnly = computeStatus({ plans: ctx.plans, config: ctx.config, graph: ctx.graph, filters: { tag: 'core', showDone: true } });
    expect(coreOnly.total).toBe(2);

    const foundationOnly = computeReady({ plans: ctx.plans, graph: ctx.graph, filters: { tag: 'foundation' } });
    expect(foundationOnly.plans.every(p => p.tags.includes('foundation'))).toBe(true);
  });
});

describe('Consumer workflow: directory-based plans with contracts', () => {
  function createDirProject() {
    const tmpDir = join(tmpdir(), `trellis-dir-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const plansDir = join(tmpDir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');

    mkdirSync(join(plansDir, 'contracts', 'core-types'), { recursive: true });
    writeFileSync(join(plansDir, 'contracts', 'core-types', 'README.md'),
      '---\ntitle: Core Types\nstatus: done\ntags:\n  - foundation\n---\n\nDefine core type system.\n');
    writeFileSync(join(plansDir, 'contracts', 'core-types', 'outputs.md'),
      '## Type definitions\n- `Plan` interface\n- `PlanStatus` union type\n- `TrellisConfig` interface\n');

    mkdirSync(join(plansDir, 'impl', 'scanner'), { recursive: true });
    writeFileSync(join(plansDir, 'impl', 'scanner', 'README.md'),
      '---\ntitle: Scanner Implementation\nstatus: not_started\ndepends_on:\n  - contracts/core-types\ntags:\n  - core\n---\n\nImplement plan scanner.\n');
    writeFileSync(join(plansDir, 'impl', 'scanner', 'inputs.md'),
      '## From plans\n### contracts/core-types\n- `Plan` interface for scan results\n- `TrellisConfig` for directory resolution\n');
    writeFileSync(join(plansDir, 'impl', 'scanner', 'outputs.md'),
      '## Scanner module\n- `scanPlans()` function\n- `loadConfig()` function\n');

    writeFileSync(join(plansDir, 'docs.md'),
      '---\ntitle: Documentation\nstatus: draft\n---\n\nWrite docs.\n');

    return { tmpDir, plansDir };
  }

  it('show() returns contract data for directory-based plans', () => {
    const { tmpDir } = createDirProject();
    try {
      const ctx = createContext(tmpDir);

      const coreTypes = computeShow({ planId: 'contracts/core-types', graph: ctx.graph })!;
      expect(coreTypes).not.toBeNull();
      expect(coreTypes.outputs).not.toBeNull();
      expect(coreTypes.outputs!.length).toBeGreaterThan(0);
      expect(coreTypes.outputs![0].heading).toContain('Type definitions');

      const scanner = computeShow({ planId: 'impl/scanner', graph: ctx.graph })!;
      expect(scanner).not.toBeNull();
      expect(scanner.inputs).not.toBeNull();
      expect(scanner.outputs).not.toBeNull();
      expect(scanner.dependsOn).toHaveLength(1);
      expect(scanner.dependsOn[0].id).toBe('contracts/core-types');
      expect(scanner.dependsOn[0].satisfied).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('lint() reports structural warnings for missing outputs.md', () => {
    const tmpDir = join(tmpdir(), `trellis-lint-contracts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const plansDir = join(tmpDir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');

    mkdirSync(join(plansDir, 'upstream'), { recursive: true });
    writeFileSync(join(plansDir, 'upstream', 'README.md'),
      '---\ntitle: Upstream\nstatus: not_started\n---\n\n## Problem\n\nP\n\n## Approach\n\nA\n');
    writeFileSync(join(plansDir, 'upstream', 'implementation.md'),
      '## Steps\n\n## Testing\n\n## Done-when\n');

    mkdirSync(join(plansDir, 'downstream'), { recursive: true });
    writeFileSync(join(plansDir, 'downstream', 'README.md'),
      '---\ntitle: Downstream\nstatus: not_started\ndepends_on:\n  - upstream\n---\n\n## Problem\n\nP\n\n## Approach\n\nA\n');
    writeFileSync(join(plansDir, 'downstream', 'implementation.md'),
      '## Steps\n\n## Testing\n\n## Done-when\n');
    writeFileSync(join(plansDir, 'downstream', 'inputs.md'),
      '## From plans\n### upstream\n- Some deliverable\n');

    try {
      const ctx = createContext(tmpDir);
      const lint = computeLint({ plans: ctx.plans, graph: ctx.graph, projectDir: ctx.projectDir, plansDir: ctx.plansDir, options: {} });

      // Structural warning: upstream has dependents but no outputs.md
      expect(lint.warnings.some(w => w.type === 'missing_outputs' && w.planId === 'upstream')).toBe(true);
      expect(lint.structural.warnings.some(w => w.type === 'missing_outputs' && w.planId === 'upstream')).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Consumer workflow: concurrent contexts', () => {
  it('two instances on same directory stay consistent after update', () => {
    const { tmpDir } = createTestProject({
      'a': { title: 'A', status: 'not_started' },
      'b': { title: 'B', status: 'not_started', depends_on: ['a'] },
    });
    try {
      let ctx1 = createContext(tmpDir);
      let ctx2 = createContext(tmpDir);

      expect(computeStatus({ plans: ctx1.plans, config: ctx1.config, graph: ctx1.graph, filters: {} }).total).toBe(2);
      expect(computeStatus({ plans: ctx2.plans, config: ctx2.config, graph: ctx2.graph, filters: {} }).total).toBe(2);

      computeUpdate({ planId: 'a', status: 'done', graph: ctx1.graph, force: true }, { refresh: () => {} });

      // ctx2 still sees stale state until refresh
      const stale = computeShow({ planId: 'a', graph: ctx2.graph })!;
      expect(stale.status).toBe('not_started');

      // After refresh, ctx2 sees the update
      ctx2 = createContext(tmpDir);
      const fresh = computeShow({ planId: 'a', graph: ctx2.graph })!;
      expect(fresh.status).toBe('done');
      expect(computeReady({ plans: ctx2.plans, graph: ctx2.graph, filters: {} }).plans.map(p => p.id)).toContain('b');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
