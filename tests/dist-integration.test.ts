import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// Import from built ESM bundle — this is what Electron consumers see
const distPath = resolve(__dirname, '../dist/index.mjs');

describe('built artifact integration', () => {
  let lib: any;

  beforeAll(async () => {
    // Ensure build exists
    if (!existsSync(distPath)) {
      execSync('npm run build', { cwd: resolve(__dirname, '..') });
    }
    lib = await import(distPath);
  });

  function createTestProject(plans: Record<string, Record<string, unknown>> = {}) {
    const tmpDir = join(tmpdir(), `trellis-dist-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const plansDir = join(tmpDir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(tmpDir, '.trellis'), 'project: dist-test\nplans_dir: plans\n');

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

  let tmpDir: string;

  beforeEach(() => {
    const project = createTestProject({
      'foundation':  { title: 'Foundation', status: 'done' },
      'feature-a':   { title: 'Feature A', status: 'not_started', depends_on: ['foundation'], tags: ['core'] },
      'feature-b':   { title: 'Feature B', status: 'not_started', depends_on: ['feature-a'] },
    });
    tmpDir = project.tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('low-level functions are accessible from ESM bundle', () => {
    expect(typeof lib.scanPlans).toBe('function');
    expect(typeof lib.buildGraph).toBe('function');
    expect(typeof lib.loadConfig).toBe('function');
    expect(typeof lib.parseFrontmatter).toBe('function');
    expect(typeof lib.filterPlans).toBe('function');
    expect(typeof lib.VALID_STATUSES).toBe('object');
    expect(lib.VALID_STATUSES).toContain('done');
  });

  it('full workflow via low-level functions from ESM bundle', () => {
    const config = lib.loadConfig(tmpDir);
    expect(config.project).toBe('dist-test');

    const plansDir = join(tmpDir, config.plans_dir);
    const plans = lib.scanPlans(plansDir);
    expect(plans).toHaveLength(3);

    const graph = lib.buildGraph(plans);
    expect(graph.ready.has('feature-a')).toBe(true);
    expect(graph.blocked.has('feature-b')).toBe(true);

    const next = lib.pickNext(graph);
    expect(next).toBe('feature-a');

    const ready = lib.newlyReady('feature-a', 'done', graph);
    expect(ready).toContain('feature-b');
  });

  it('Trellis class is constructable and functional from ESM bundle', () => {
    const t = new lib.Trellis(tmpDir);
    expect(t.config.project).toBe('dist-test');

    const status = t.status({ showDone: true });
    expect(status.total).toBe(3);
    expect(status.byStatus.done).toHaveLength(1);
    expect(status.byStatus.ready).toHaveLength(1);
    expect(status.byStatus.blocked).toHaveLength(1);
  });

  it('full workflow: status → ready → update → verify unblock', () => {
    const t = new lib.Trellis(tmpDir);

    const ready = t.ready();
    expect(ready.plans.map((p: any) => p.id)).toContain('feature-a');
    expect(ready.next).toBe('feature-a');

    const showB = t.show('feature-b');
    expect(showB.blocked).toBe(true);

    const updateResult = t.update('feature-a', 'done');
    expect(updateResult.previousStatus).toBe('not_started');
    expect(updateResult.newlyReady).toContain('feature-b');

    expect(t.show('feature-b').ready).toBe(true);
  });

  it('CJS require also works', () => {
    const cjsLib = require(resolve(__dirname, '../dist/index.cjs'));
    expect(typeof cjsLib.scanPlans).toBe('function');
    expect(typeof cjsLib.buildGraph).toBe('function');

    const config = cjsLib.loadConfig(tmpDir);
    expect(config.project).toBe('dist-test');

    const plansDir = join(tmpDir, config.plans_dir);
    const plans = cjsLib.scanPlans(plansDir);
    expect(plans).toHaveLength(3);
  });
});
