import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Trellis } from '../src/api.ts';

function createTestProject() {
  const tmpDir = join(tmpdir(), `trellis-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const plansDir = join(tmpDir, 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(tmpDir, '.trellis'), 'project: test-project\nplans_dir: plans\n');
  return { tmpDir, plansDir };
}

function writePlan(plansDir: string, id: string, frontmatter: Record<string, unknown>, body?: string) {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - ${i}`).join('\n')}`;
      return `${k}: ${v}`;
    })
    .join('\n');
  const planDir = join(plansDir, id);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, 'README.md'), `---\n${fm}\n---\n${body ?? `\nBody for ${id}\n`}`);
}

describe('Trellis class', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes with project directory', () => {
    const t = new Trellis(tmpDir);
    expect(t.config.project).toBe('test-project');
  });

  it('scans lazily on first query', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const t = new Trellis(tmpDir);
    const result = t.status();
    expect(result.total).toBe(1);
  });

  it('refresh rescans from disk', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const t = new Trellis(tmpDir);
    const r1 = t.status();
    expect(r1.total).toBe(1);

    writePlan(plansDir, 'b', { title: 'B', status: 'not_started' });
    t.refresh();
    const r2 = t.status();
    expect(r2.total).toBe(2);
  });
});

describe('Trellis.status()', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('categorizes plans by status', () => {
    writePlan(plansDir, 'done-plan', { title: 'Done', status: 'done' });
    writePlan(plansDir, 'ready-plan', { title: 'Ready', status: 'not_started', depends_on: ['done-plan'] });
    writePlan(plansDir, 'blocked-plan', { title: 'Blocked', status: 'not_started', depends_on: ['ready-plan'] });
    writePlan(plansDir, 'ip-plan', { title: 'In Progress', status: 'in_progress' });
    writePlan(plansDir, 'draft-plan', { title: 'Draft', status: 'draft' });

    const t = new Trellis(tmpDir);
    const result = t.status({ showDone: true });

    expect(result.project).toBe('test-project');
    expect(result.total).toBe(5);
    expect(result.byStatus.ready).toHaveLength(1);
    expect(result.byStatus.ready[0].id).toBe('ready-plan');
    expect(result.byStatus.blocked).toHaveLength(1);
    expect(result.byStatus.blocked[0].id).toBe('blocked-plan');
    expect(result.byStatus.blocked[0].waitingOn).toEqual(['ready-plan']);
    expect(result.byStatus.inProgress).toHaveLength(1);
    expect(result.byStatus.draft).toHaveLength(1);
    expect(result.byStatus.done).toHaveLength(1);
  });

  it('filters by tag', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started', tags: ['core'] });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', tags: ['extra'] });

    const t = new Trellis(tmpDir);
    const result = t.status({ tag: 'core' });
    expect(result.total).toBe(1);
    expect(result.byStatus.ready[0].id).toBe('a');
  });

  it('hides done/archived by default, shows with flags', () => {
    writePlan(plansDir, 'done', { title: 'Done', status: 'done' });
    writePlan(plansDir, 'archived', { title: 'Archived', status: 'archived' });
    writePlan(plansDir, 'active', { title: 'Active', status: 'not_started' });

    const t = new Trellis(tmpDir);

    const defaultResult = t.status();
    expect(defaultResult.total).toBe(3);
    expect(defaultResult.byStatus.done).toHaveLength(0);
    expect(defaultResult.byStatus.archived).toHaveLength(0);

    const allResult = t.status({ showDone: true, showArchived: true });
    expect(allResult.total).toBe(3);
    expect(allResult.byStatus.done).toHaveLength(1);
    expect(allResult.byStatus.archived).toHaveLength(1);
  });

  it('includes chunk summary', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const t = new Trellis(tmpDir);
    const result = t.status();
    expect(result.chunks).toBeDefined();
    expect(typeof result.chunks.total).toBe('number');
    expect(typeof result.chunks.overBudget).toBe('number');
  });
});

describe('Trellis.ready()', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ready plans and next pick', () => {
    writePlan(plansDir, 'done', { title: 'Done', status: 'done' });
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started', depends_on: ['done'] });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', depends_on: ['done'] });
    writePlan(plansDir, 'blocked', { title: 'Blocked', status: 'not_started', depends_on: ['a'] });

    const t = new Trellis(tmpDir);
    const result = t.ready();
    expect(result.plans).toHaveLength(2);
    expect(result.plans.map(p => p.id).sort()).toEqual(['a', 'b']);
    expect(result.next).toBeTruthy();
    expect(['a', 'b']).toContain(result.next);
  });

  it('filters by tag', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started', tags: ['core'] });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', tags: ['extra'] });

    const t = new Trellis(tmpDir);
    const result = t.ready({ tag: 'core' });
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].id).toBe('a');
  });
});

describe('Trellis.show()', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns full plan details', () => {
    writePlan(plansDir, 'dep', { title: 'Dep', status: 'done' });
    writePlan(plansDir, 'main', { title: 'Main', status: 'not_started', depends_on: ['dep'], tags: ['core'], repo: 'public' });
    writePlan(plansDir, 'child', { title: 'Child', status: 'not_started', depends_on: ['main'] });

    const t = new Trellis(tmpDir);
    const result = t.show('main');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('main');
    expect(result!.title).toBe('Main');
    expect(result!.ready).toBe(true);
    expect(result!.blocked).toBe(false);
    expect(result!.dependsOn).toHaveLength(1);
    expect(result!.dependsOn[0].id).toBe('dep');
    expect(result!.dependsOn[0].satisfied).toBe(true);
    expect(result!.blocks).toContain('child');
    expect(result!.criticalPath).toEqual(['dep', 'main']);
    expect(result!.body).toContain('Body for main');
  });

  it('returns null for unknown plan', () => {
    const t = new Trellis(tmpDir);
    expect(t.show('nonexistent')).toBeNull();
  });

  it('reports not_found for missing dependency', () => {
    writePlan(plansDir, 'orphan', { title: 'Orphan', status: 'not_started', depends_on: ['ghost'] });

    const t = new Trellis(tmpDir);
    const result = t.show('orphan');

    expect(result).not.toBeNull();
    expect(result!.dependsOn).toHaveLength(1);
    expect(result!.dependsOn[0].id).toBe('ghost');
    expect(result!.dependsOn[0].status).toBe('not_found');
    expect(result!.dependsOn[0].satisfied).toBe(false);
  });
});

describe('Trellis.update()', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('updates plan status and returns result', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', depends_on: ['a'] });

    const t = new Trellis(tmpDir);
    const result = t.update('a', 'done', { force: true });

    expect(result.id).toBe('a');
    expect(result.previousStatus).toBe('not_started');
    expect(result.newStatus).toBe('done');
    expect(result.newlyReady).toEqual(['b']);
  });

  it('throws on invalid status', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const t = new Trellis(tmpDir);
    expect(() => t.update('a', 'invalid' as any)).toThrow();
  });

  it('throws on unknown plan', () => {
    const t = new Trellis(tmpDir);
    expect(() => t.update('nonexistent', 'done')).toThrow();
  });

  it('handles same-status update', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'in_progress' });
    const t = new Trellis(tmpDir);
    const result = t.update('a', 'in_progress', { force: true });

    expect(result.previousStatus).toBe('in_progress');
    expect(result.newStatus).toBe('in_progress');
    expect(result.backward).toBe(false);
  });

  it('auto-refreshes after update', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const t = new Trellis(tmpDir);

    t.update('a', 'in_progress', { force: true });
    const result = t.status({ showDone: true, showArchived: true });
    expect(result.byStatus.inProgress).toHaveLength(1);
  });
});

describe('Trellis.lint()', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns clean result for valid plans', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' }, '\n## Problem\n\nP\n\n## Approach\n\nA\n');
    writeFileSync(join(plansDir, 'a', 'implementation.md'), '## Steps\n\n## Testing\n\n## Done-when\n');
    writeFileSync(join(plansDir, 'a', 'outputs.md'), '## Types\n- Person\n');
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', depends_on: ['a'] }, '\n## Problem\n\nP\n\n## Approach\n\nA\n');
    writeFileSync(join(plansDir, 'b', 'implementation.md'), '## Steps\n\n## Testing\n\n## Done-when\n');
    writeFileSync(join(plansDir, 'b', 'inputs.md'), '## From plans\n\n### a\n- types\n');

    const t = new Trellis(tmpDir);
    const result = t.lint();
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports missing dependencies', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started', depends_on: ['nonexistent'] });

    const t = new Trellis(tmpDir);
    const result = t.lint();
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.type === 'missing_dependency')).toBe(true);
  });

  it('strict mode fails on warnings', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'draft' }, '\n## Problem\n\nP\n');

    const t = new Trellis(tmpDir);
    const relaxed = t.lint();
    const strict = t.lint({ strict: true });
    expect(relaxed.ok).toBe(true);
    expect(strict.ok).toBe(false);
  });

  it('detects cycles', () => {
    writePlan(plansDir, 'x', { title: 'X', status: 'not_started', depends_on: ['y'] });
    writePlan(plansDir, 'y', { title: 'Y', status: 'not_started', depends_on: ['x'] });

    const t = new Trellis(tmpDir);
    const result = t.lint();
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.type === 'cycle')).toBe(true);
  });

  it('detects done plan with incomplete dependency', () => {
    writePlan(plansDir, 'dep', { title: 'Dep', status: 'not_started' });
    writePlan(plansDir, 'early-done', { title: 'Early Done', status: 'done', depends_on: ['dep'] });

    const t = new Trellis(tmpDir);
    const result = t.lint();
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.type === 'inconsistency' && e.planId === 'early-done')).toBe(true);
  });

  it('warns on in_progress plan with incomplete dependency', () => {
    writePlan(plansDir, 'dep', { title: 'Dep', status: 'not_started' });
    writePlan(plansDir, 'eager', { title: 'Eager', status: 'in_progress', depends_on: ['dep'] });

    const t = new Trellis(tmpDir);
    const result = t.lint();
    expect(result.warnings.some(w => w.type === 'incomplete_deps' && w.planId === 'eager')).toBe(true);
  });
});

describe('Trellis.graph()', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns nodes, edges, chunks and cross-chunk edges', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done' });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', depends_on: ['a'] });

    const t = new Trellis(tmpDir);
    const result = t.graph();

    expect(result.project).toBe('test-project');
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({ from: 'a', to: 'b' });
    expect(result.nodes.find(n => n.id === 'a')!.status).toBe('done');
    expect(result.nodes.find(n => n.id === 'b')!.ready).toBe(true);
    expect(Array.isArray(result.chunks)).toBe(true);
    expect(Array.isArray(result.crossChunkEdges)).toBe(true);
  });

  it('includes plan body for detail views', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'not_started' });
    const t = new Trellis(tmpDir);
    const result = t.graph();
    expect(result.nodes[0].body).toContain('Body for a');
  });
});

describe('Trellis.epic()', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns all epics when no name given', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done', tags: ['epic:v1'] });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', tags: ['epic:v1'] });
    writePlan(plansDir, 'c', { title: 'C', status: 'not_started', tags: ['epic:v2'] });

    const t = new Trellis(tmpDir);
    const result = t.epic();
    expect(result).toHaveLength(2);

    const v1 = result.find(e => e.epic === 'v1')!;
    expect(v1.total).toBe(2);
    expect(v1.done).toBe(1);
    expect(v1.progress).toBe(0.5);
  });

  it('returns single epic with plans when name given', () => {
    writePlan(plansDir, 'a', { title: 'A', status: 'done', tags: ['epic:v1'] });
    writePlan(plansDir, 'b', { title: 'B', status: 'not_started', tags: ['epic:v1'] });

    const t = new Trellis(tmpDir);
    const result = t.epic('v1');
    expect(result).toHaveLength(1);
    expect(result[0].plans).toHaveLength(2);
  });

  it('returns empty array for unknown epic', () => {
    const t = new Trellis(tmpDir);
    expect(t.epic('nonexistent')).toHaveLength(0);
  });
});

describe('Trellis.chunks()', () => {
  let tmpDir: string;
  let plansDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
    plansDir = project.plansDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('filters by tag and repo', () => {
    writePlan(plansDir, 'contracts/types', { title: 'Types', status: 'done', tags: ['foundation'], repo: 'public' });
    writePlan(plansDir, 'impl/core', { title: 'Core', status: 'not_started', tags: ['core'], repo: 'private' });

    const t = new Trellis(tmpDir);
    const byTag = t.chunks({ tag: 'foundation' });
    const planIds = byTag.chunks.flatMap(c => c.plans.map(p => p.id));
    expect(planIds).toContain('contracts/types');
    expect(planIds).not.toContain('impl/core');
  });

  it('returns chunk result', () => {
    writePlan(plansDir, 'contracts/types', { title: 'Types', status: 'done' });
    writePlan(plansDir, 'contracts/api', { title: 'API', status: 'not_started', depends_on: ['contracts/types'] });
    writePlan(plansDir, 'impl/core', { title: 'Core', status: 'not_started', depends_on: ['contracts/types'] });

    const t = new Trellis(tmpDir);
    const result = t.chunks();
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(Array.isArray(result.crossChunkEdges)).toBe(true);
    expect(typeof result.config.maxLines).toBe('number');
  });
});

describe('Trellis: empty project', () => {
  let tmpDir: string;

  beforeEach(() => {
    const project = createTestProject();
    tmpDir = project.tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('all methods handle zero plans gracefully', () => {
    const t = new Trellis(tmpDir);

    const status = t.status();
    expect(status.total).toBe(0);
    expect(status.byStatus.ready).toHaveLength(0);

    const ready = t.ready();
    expect(ready.plans).toHaveLength(0);
    expect(ready.next).toBeNull();

    const lint = t.lint();
    expect(lint.ok).toBe(true);
    expect(lint.total).toBe(0);

    const graph = t.graph();
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);

    const epics = t.epic();
    expect(epics).toHaveLength(0);

    const chunks = t.chunks();
    expect(chunks.chunks).toHaveLength(0);
  });
});
