import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import from barrel — this is the consumer's entry point
import { Trellis } from '../src/index.ts';
import type {
  StatusResult,
  ReadyResult,
  ShowResult,
  UpdateResult,
  LintResult,
  GraphResult,
  EpicResult,
} from '../src/index.ts';

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
    const parts = id.split('/');
    if (parts.length > 1) {
      mkdirSync(join(plansDir, ...parts.slice(0, -1)), { recursive: true });
    }
    writeFileSync(join(plansDir, `${id}.md`), `---\n${fm}\n---\n\nBody for ${id}\n`);
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
    const t = new Trellis(tmpDir);

    const status: StatusResult = t.status({ showDone: true });
    expect(status.project).toBe('test-project');
    expect(status.total).toBe(6);
    expect(status.byStatus.done).toHaveLength(2);
    expect(status.byStatus.inProgress).toHaveLength(1);
    expect(status.byStatus.ready.map(p => p.id)).toContain('impl/graph');
    expect(status.byStatus.blocked.map(p => p.id)).toContain('impl/cli');

    const ready: ReadyResult = t.ready();
    expect(ready.plans.length).toBeGreaterThanOrEqual(1);
    expect(ready.next).toBeTruthy();

    const show: ShowResult = t.show('impl/cli')!;
    expect(show).not.toBeNull();
    expect(show.blocked).toBe(true);
    expect(show.dependsOn).toHaveLength(2);
    expect(show.dependsOn.find(d => d.id === 'impl/scanner')!.satisfied).toBe(false);
    expect(show.dependsOn.find(d => d.id === 'impl/graph')!.satisfied).toBe(false);
    expect(show.criticalPath.length).toBeGreaterThanOrEqual(2);
    expect(show.body).toContain('Body for impl/cli');

    const graph: GraphResult = t.graph();
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
    const t = new Trellis(tmpDir);

    expect(t.ready().plans.map(p => p.id)).toContain('feature-a');
    expect(t.show('feature-b')!.blocked).toBe(true);

    const startResult: UpdateResult = t.update('feature-a', 'in_progress');
    expect(startResult.previousStatus).toBe('not_started');
    expect(startResult.newStatus).toBe('in_progress');
    expect(startResult.backward).toBe(false);

    const afterStart = t.status({ showDone: true });
    expect(afterStart.byStatus.inProgress.map(p => p.id)).toContain('feature-a');

    const doneResult: UpdateResult = t.update('feature-a', 'done');
    expect(doneResult.newlyReady).toContain('feature-b');

    expect(t.show('feature-b')!.blocked).toBe(false);
    expect(t.show('feature-b')!.ready).toBe(true);
    expect(t.ready().plans.map(p => p.id)).toContain('feature-b');
  });

  it('backward status transition clears timestamps', () => {
    const t = new Trellis(tmpDir);

    t.update('feature-a', 'in_progress');
    const afterStart = t.show('feature-a')!;
    expect(afterStart.startedAt).toBeTruthy();

    t.update('feature-a', 'done');
    const afterDone = t.show('feature-a')!;
    expect(afterDone.completedAt).toBeTruthy();

    const revertResult = t.update('feature-a', 'not_started');
    expect(revertResult.backward).toBe(true);

    const afterRevert = t.show('feature-a')!;
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
    const t = new Trellis(tmpDir);
    const result: LintResult = t.lint();

    expect(result.ok).toBe(false);
    expect(result.total).toBe(4);
    expect(result.errors.some(e => e.type === 'missing_dependency' && e.planId === 'broken')).toBe(true);
    expect(result.warnings.some(w => w.type === 'orphan' && w.planId === 'orphan')).toBe(true);
  });

  it('strict mode fails on warnings too', () => {
    const t = new Trellis(tmpDir);
    const relaxed = t.lint();
    const strict = t.lint({ strict: true });

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
    const t = new Trellis(tmpDir);
    const epics: EpicResult[] = t.epic();

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
    const t = new Trellis(tmpDir);
    const [v1]: EpicResult[] = t.epic('v1');

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
      const t = new Trellis(tmpDir);
      expect(t.config.plans_dir).toBe('plans');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('show returns null for unknown plan', () => {
    const { tmpDir } = createTestProject({
      'a': { title: 'A', status: 'not_started' },
    });
    try {
      const t = new Trellis(tmpDir);
      expect(t.show('nonexistent')).toBeNull();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('update throws on unknown plan', () => {
    const { tmpDir } = createTestProject({
      'a': { title: 'A', status: 'not_started' },
    });
    try {
      const t = new Trellis(tmpDir);
      expect(() => t.update('nonexistent', 'done')).toThrow('not found');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('update throws on invalid status', () => {
    const { tmpDir } = createTestProject({
      'a': { title: 'A', status: 'not_started' },
    });
    try {
      const t = new Trellis(tmpDir);
      expect(() => t.update('a', 'invalid' as any)).toThrow('Invalid status');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles corrupt frontmatter gracefully', () => {
    const tmpDir = join(tmpdir(), `trellis-corrupt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const plansDir = join(tmpDir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');

    writeFileSync(join(plansDir, 'good.md'), '---\ntitle: Good Plan\nstatus: not_started\n---\n\nBody\n');
    writeFileSync(join(plansDir, 'corrupt.md'), '---\n: invalid yaml {{{\nstatus: [broken\n---\n\nBody\n');

    try {
      const t = new Trellis(tmpDir);
      const status = t.status();
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
    const t = new Trellis(tmpDir);
    const result = t.chunks();

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(Array.isArray(result.crossChunkEdges)).toBe(true);
    expect(typeof result.config.maxLines).toBe('number');

    const allPlanIds = result.chunks.flatMap(c => c.plans.map(p => p.id)).sort();
    expect(allPlanIds).toEqual(['contracts/api', 'contracts/types', 'impl/core', 'impl/extra']);
  });

  it('status filters by tag', () => {
    const t = new Trellis(tmpDir);

    const coreOnly = t.status({ tag: 'core', showDone: true });
    expect(coreOnly.total).toBe(2);

    const foundationOnly = t.ready({ tag: 'foundation' });
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
      const t = new Trellis(tmpDir);

      const coreTypes = t.show('contracts/core-types')!;
      expect(coreTypes).not.toBeNull();
      expect(coreTypes.outputs).not.toBeNull();
      expect(coreTypes.outputs!.length).toBeGreaterThan(0);
      expect(coreTypes.outputs![0].heading).toContain('Type definitions');

      const scanner = t.show('impl/scanner')!;
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

  it('graph() includes contract content on nodes', () => {
    const { tmpDir } = createDirProject();
    try {
      const t = new Trellis(tmpDir);
      const graph = t.graph();

      const coreNode = graph.nodes.find(n => n.id === 'contracts/core-types')!;
      expect(coreNode.outputs).toBeDefined();
      expect(coreNode.outputs).toContain('Type definitions');

      const scannerNode = graph.nodes.find(n => n.id === 'impl/scanner')!;
      expect(scannerNode.inputs).toBeDefined();
      expect(scannerNode.inputs).toContain('contracts/core-types');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('lint() reports contract-related warnings', () => {
    const tmpDir = join(tmpdir(), `trellis-lint-contracts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const plansDir = join(tmpDir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');

    mkdirSync(join(plansDir, 'upstream'), { recursive: true });
    writeFileSync(join(plansDir, 'upstream', 'README.md'),
      '---\ntitle: Upstream\nstatus: done\n---\n\nNo outputs defined.\n');

    mkdirSync(join(plansDir, 'downstream'), { recursive: true });
    writeFileSync(join(plansDir, 'downstream', 'README.md'),
      '---\ntitle: Downstream\nstatus: not_started\ndepends_on:\n  - upstream\n---\n\nNeeds upstream.\n');
    writeFileSync(join(plansDir, 'downstream', 'inputs.md'),
      '## From plans\n### upstream\n- Some deliverable\n');

    try {
      const t = new Trellis(tmpDir);
      const lint = t.lint();

      expect(lint.warnings.some(w => w.type === 'missing_outputs' && w.planId === 'upstream')).toBe(true);
      expect(lint.warnings.some(w => w.type === 'missing_upstream_outputs' && w.planId === 'downstream')).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Consumer workflow: concurrent Trellis instances', () => {
  it('two instances on same directory stay consistent after update', () => {
    const { tmpDir } = createTestProject({
      'a': { title: 'A', status: 'not_started' },
      'b': { title: 'B', status: 'not_started', depends_on: ['a'] },
    });
    try {
      const t1 = new Trellis(tmpDir);
      const t2 = new Trellis(tmpDir);

      expect(t1.status().total).toBe(2);
      expect(t2.status().total).toBe(2);

      t1.update('a', 'done');

      // t2 still sees stale state until refresh
      const stale = t2.show('a')!;
      expect(stale.status).toBe('not_started');

      // After refresh, t2 sees the update
      t2.refresh();
      const fresh = t2.show('a')!;
      expect(fresh.status).toBe('done');
      expect(t2.ready().plans.map(p => p.id)).toContain('b');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
