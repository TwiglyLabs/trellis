import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import {
  BUILT_IN_TEMPLATES,
  BUILT_IN_TEMPLATE_NAMES,
  loadTemplate,
  listTemplateTypes,
  stripHints,
  writeBuiltInTemplates,
} from './templates.ts';
import { createFixture } from './__tests__/helpers.ts';
import { createContext } from './core/index.ts';
import { computeCreate } from './features/create/logic.ts';
import { computeSet } from './features/set/logic.ts';
import { computeShow } from './features/show/logic.ts';
import { createCommand } from './features/create/command.ts';
import { initCommand } from './features/init/command.ts';
import { computeStatus } from './features/status/logic.ts';
import { createMcpServer } from './mcp.ts';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

// MCP helper
async function callTool(server: any, name: string, args: Record<string, any>) {
  const tool = server._registeredTools[name];
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  return tool.handler(args, {});
}

describe('built-in template content', () => {
  it('has four built-in templates', () => {
    expect(BUILT_IN_TEMPLATE_NAMES).toEqual(
      expect.arrayContaining(['feature', 'bugfix', 'refactor', 'investigation']),
    );
    expect(BUILT_IN_TEMPLATE_NAMES).toHaveLength(4);
  });

  it('feature template has README.md and implementation.md', () => {
    const t = BUILT_IN_TEMPLATES.feature;
    expect(t['README.md']).toBeDefined();
    expect(t['implementation.md']).toBeDefined();
    expect(t['README.md']).toContain('## Problem');
    expect(t['README.md']).toContain('## Approach');
    expect(t['implementation.md']).toContain('## Steps');
    expect(t['implementation.md']).toContain('## Testing');
    expect(t['implementation.md']).toContain('## Done-when');
  });

  it('bugfix template has README.md and implementation.md', () => {
    const t = BUILT_IN_TEMPLATES.bugfix;
    expect(t['README.md']).toBeDefined();
    expect(t['implementation.md']).toBeDefined();
    expect(t['README.md']).toContain('reproduction steps');
    expect(t['README.md']).toContain('root cause');
  });

  it('refactor template has README.md and implementation.md', () => {
    const t = BUILT_IN_TEMPLATES.refactor;
    expect(t['README.md']).toBeDefined();
    expect(t['implementation.md']).toBeDefined();
    expect(t['README.md']).toContain('current state');
    expect(t['README.md']).toContain('target state');
  });

  it('investigation template has README.md only (no implementation.md)', () => {
    const t = BUILT_IN_TEMPLATES.investigation;
    expect(t['README.md']).toBeDefined();
    expect(t['implementation.md']).toBeUndefined();
    expect(t['README.md']).toContain('## Findings');
    expect(t['README.md']).toContain('hypothesis');
  });

  it('all templates have hint comments', () => {
    for (const [type, files] of Object.entries(BUILT_IN_TEMPLATES)) {
      for (const [filename, content] of Object.entries(files)) {
        expect(content, `${type}/${filename} should have hints`).toContain('<!-- hint:');
      }
    }
  });
});

describe('stripHints', () => {
  it('removes single-line hint comments', () => {
    const input = '## Problem\n\n<!-- hint: Describe the problem. -->\n\n## Approach\n';
    const result = stripHints(input);
    expect(result).not.toContain('hint');
    expect(result).toContain('## Problem');
    expect(result).toContain('## Approach');
  });

  it('removes multi-line hint comments', () => {
    const input = '## Problem\n\n<!-- hint: This is\na multi-line hint. -->\n\n';
    const result = stripHints(input);
    expect(result).not.toContain('hint');
    expect(result).toContain('## Problem');
  });

  it('preserves non-hint comments', () => {
    const input = '## Problem\n\n<!-- TODO: Fix this -->\n\n';
    const result = stripHints(input);
    expect(result).toContain('TODO: Fix this');
  });

  it('passes through content with no hints unchanged', () => {
    const input = '## Problem\n\nSome content here.\n\n## Approach\n\nMore content.\n';
    const result = stripHints(input);
    expect(result).toBe(input);
  });
});

describe('loadTemplate', () => {
  it('returns built-in template for known types', () => {
    const { root } = createFixture([]);
    const t = loadTemplate(root, 'feature');
    expect(t).not.toBeNull();
    expect(t!['README.md']).toContain('## Problem');
  });

  it('returns null for unknown type', () => {
    const { root } = createFixture([]);
    const t = loadTemplate(root, 'nonexistent');
    expect(t).toBeNull();
  });

  it('prefers custom template over built-in', () => {
    const { root } = createFixture([]);
    const customDir = join(root, '.trellis', 'templates', 'feature');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(customDir, 'README.md'), '## Problem\n\nCustom feature template\n');

    const t = loadTemplate(root, 'feature');
    expect(t).not.toBeNull();
    expect(t!['README.md']).toContain('Custom feature template');
  });

  it('loads custom template for unknown type', () => {
    const { root } = createFixture([]);
    const customDir = join(root, '.trellis', 'templates', 'custom-type');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(customDir, 'README.md'), '## Problem\n\nCustom content\n');

    const t = loadTemplate(root, 'custom-type');
    expect(t).not.toBeNull();
    expect(t!['README.md']).toContain('Custom content');
  });

  it('falls back to built-in when custom directory is empty', () => {
    const { root } = createFixture([]);
    const customDir = join(root, '.trellis', 'templates', 'feature');
    mkdirSync(customDir, { recursive: true });
    // Directory exists but has no .md files
    writeFileSync(join(customDir, 'notes.txt'), 'not a markdown file');

    const t = loadTemplate(root, 'feature');
    expect(t).not.toBeNull();
    // Should get the built-in feature template, not the empty custom one
    expect(t!['README.md']).toContain('<!-- hint:');
    expect(t!['implementation.md']).toBeDefined();
  });
});

describe('listTemplateTypes', () => {
  it('returns built-in types when no custom templates', () => {
    const { root } = createFixture([]);
    const types = listTemplateTypes(root);
    expect(types).toContain('feature');
    expect(types).toContain('bugfix');
    expect(types).toContain('refactor');
    expect(types).toContain('investigation');
  });

  it('includes custom types', () => {
    const { root } = createFixture([]);
    const customDir = join(root, '.trellis', 'templates', 'spike');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(customDir, 'README.md'), '## Problem\n');

    const types = listTemplateTypes(root);
    expect(types).toContain('spike');
    expect(types).toContain('feature');
  });

  it('returns sorted list', () => {
    const { root } = createFixture([]);
    const types = listTemplateTypes(root);
    const sorted = [...types].sort();
    expect(types).toEqual(sorted);
  });

  it('ignores non-directory entries in templates dir', () => {
    const { root } = createFixture([]);
    const templatesDir = join(root, '.trellis', 'templates');
    mkdirSync(templatesDir, { recursive: true });
    // Create a file (not a directory) in the templates dir
    writeFileSync(join(templatesDir, 'stray-file.md'), '# Not a template');

    const types = listTemplateTypes(root);
    expect(types).not.toContain('stray-file.md');
    // Built-in types should still be present
    expect(types).toContain('feature');
  });
});

describe('writeBuiltInTemplates', () => {
  it('writes all four templates', () => {
    const { root } = createFixture([]);
    const written = writeBuiltInTemplates(root);
    expect(written).toHaveLength(4);
    expect(written).toContain('feature');
    expect(written).toContain('bugfix');
    expect(written).toContain('refactor');
    expect(written).toContain('investigation');

    // Verify files exist
    expect(existsSync(join(root, '.trellis', 'templates', 'feature', 'README.md'))).toBe(true);
    expect(existsSync(join(root, '.trellis', 'templates', 'feature', 'implementation.md'))).toBe(true);
    expect(existsSync(join(root, '.trellis', 'templates', 'investigation', 'README.md'))).toBe(true);
    expect(existsSync(join(root, '.trellis', 'templates', 'investigation', 'implementation.md'))).toBe(false);
  });

  it('skips existing template directories', () => {
    const { root } = createFixture([]);
    const featureDir = join(root, '.trellis', 'templates', 'feature');
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, 'README.md'), '## Custom\n');

    const written = writeBuiltInTemplates(root);
    expect(written).not.toContain('feature');
    expect(written).toHaveLength(3);

    // Verify custom content is preserved
    const content = readFileSync(join(featureDir, 'README.md'), 'utf8');
    expect(content).toBe('## Custom\n');
  });

  it('is idempotent — second call writes nothing', () => {
    const { root } = createFixture([]);
    writeBuiltInTemplates(root);
    const written2 = writeBuiltInTemplates(root);
    expect(written2).toHaveLength(0);
  });
});

describe('computeCreate with type', () => {
  it('creates plan with feature template', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);

    const result = computeCreate({
      id: 'my-feature',
      opts: { title: 'My Feature', type: 'feature' },
      plansDir: ctx.plansDir,
      graph: ctx.graph,
      projectDir: root,
    }, { refresh: () => {} });

    expect(result.id).toBe('my-feature');

    const readme = readFileSync(join(root, 'plans', 'my-feature', 'README.md'), 'utf8');
    const parsed = matter(readme);
    expect(parsed.data.type).toBe('feature');
    expect(parsed.data.title).toBe('My Feature');
    expect(parsed.data.status).toBe('draft');
    expect(readme).toContain('## Problem');
    expect(readme).toContain('## Approach');
    // Hints should be stripped
    expect(readme).not.toContain('<!-- hint:');

    // Implementation.md should exist
    expect(existsSync(join(root, 'plans', 'my-feature', 'implementation.md'))).toBe(true);
    const impl = readFileSync(join(root, 'plans', 'my-feature', 'implementation.md'), 'utf8');
    expect(impl).toContain('## Steps');
    expect(impl).toContain('## Testing');
    expect(impl).toContain('## Done-when');
    expect(impl).not.toContain('<!-- hint:');
  });

  it('creates plan with investigation template (no implementation.md)', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);

    computeCreate({
      id: 'my-investigation',
      opts: { title: 'My Investigation', type: 'investigation' },
      plansDir: ctx.plansDir,
      graph: ctx.graph,
      projectDir: root,
    }, { refresh: () => {} });

    expect(existsSync(join(root, 'plans', 'my-investigation', 'README.md'))).toBe(true);
    expect(existsSync(join(root, 'plans', 'my-investigation', 'implementation.md'))).toBe(false);

    const readme = readFileSync(join(root, 'plans', 'my-investigation', 'README.md'), 'utf8');
    expect(readme).toContain('## Findings');
    expect(readme).not.toContain('<!-- hint:');
  });

  it('creates plan with bugfix template', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);

    computeCreate({
      id: 'my-bugfix',
      opts: { title: 'My Bugfix', type: 'bugfix' },
      plansDir: ctx.plansDir,
      graph: ctx.graph,
      projectDir: root,
    }, { refresh: () => {} });

    const readme = readFileSync(join(root, 'plans', 'my-bugfix', 'README.md'), 'utf8');
    const parsed = matter(readme);
    expect(parsed.data.type).toBe('bugfix');
  });

  it('creates plan with refactor template', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);

    computeCreate({
      id: 'my-refactor',
      opts: { title: 'My Refactor', type: 'refactor' },
      plansDir: ctx.plansDir,
      graph: ctx.graph,
      projectDir: root,
    }, { refresh: () => {} });

    const readme = readFileSync(join(root, 'plans', 'my-refactor', 'README.md'), 'utf8');
    const parsed = matter(readme);
    expect(parsed.data.type).toBe('refactor');
    expect(existsSync(join(root, 'plans', 'my-refactor', 'implementation.md'))).toBe(true);
  });

  it('creates plan without type uses generic scaffold', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);

    computeCreate({
      id: 'no-type',
      opts: { title: 'No Type' },
      plansDir: ctx.plansDir,
      graph: ctx.graph,
      projectDir: root,
    }, { refresh: () => {} });

    const readme = readFileSync(join(root, 'plans', 'no-type', 'README.md'), 'utf8');
    const parsed = matter(readme);
    expect(parsed.data.type).toBeUndefined();
    expect(readme).toContain('## Problem');
    expect(readme).toContain('## Approach');
    expect(existsSync(join(root, 'plans', 'no-type', 'implementation.md'))).toBe(false);
  });

  it('throws on unknown type', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);

    expect(() => computeCreate({
      id: 'bad-type',
      opts: { title: 'Bad Type', type: 'nonexistent' },
      plansDir: ctx.plansDir,
      graph: ctx.graph,
      projectDir: root,
    }, { refresh: () => {} })).toThrow('Unknown template type');
  });

  it('uses custom template when available', () => {
    const { root } = createFixture([]);
    const customDir = join(root, '.trellis', 'templates', 'custom-type');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(customDir, 'README.md'), '## Problem\n\n<!-- hint: Custom hint -->\n\n## Custom Section\n');

    const ctx = createContext(root);

    computeCreate({
      id: 'custom',
      opts: { title: 'Custom', type: 'custom-type' },
      plansDir: ctx.plansDir,
      graph: ctx.graph,
      projectDir: root,
    }, { refresh: () => {} });

    const readme = readFileSync(join(root, 'plans', 'custom', 'README.md'), 'utf8');
    expect(readme).toContain('## Custom Section');
    expect(readme).not.toContain('<!-- hint:');
    const parsed = matter(readme);
    expect(parsed.data.type).toBe('custom-type');
  });

  it('uses modified built-in template from .trellis/templates/', () => {
    const { root } = createFixture([]);
    const featureDir = join(root, '.trellis', 'templates', 'feature');
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, 'README.md'), '## Problem\n\nModified feature\n\n## Approach\n\n## Extra Section\n');

    const ctx = createContext(root);

    computeCreate({
      id: 'modified-feature',
      opts: { title: 'Modified Feature', type: 'feature' },
      plansDir: ctx.plansDir,
      graph: ctx.graph,
      projectDir: root,
    }, { refresh: () => {} });

    const readme = readFileSync(join(root, 'plans', 'modified-feature', 'README.md'), 'utf8');
    expect(readme).toContain('## Extra Section');
    expect(readme).toContain('Modified feature');
  });

  it('sets type in frontmatter', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);

    computeCreate({
      id: 'typed',
      opts: { title: 'Typed Plan', type: 'bugfix' },
      plansDir: ctx.plansDir,
      graph: ctx.graph,
      projectDir: root,
    }, { refresh: () => {} });

    const readme = readFileSync(join(root, 'plans', 'typed', 'README.md'), 'utf8');
    const parsed = matter(readme);
    expect(parsed.data.type).toBe('bugfix');
  });

  it('creates plan with type and depends_on', () => {
    const { root } = createFixture([
      { id: 'dep-plan', title: 'Dep', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    const ctx = createContext(root);

    computeCreate({
      id: 'with-deps',
      opts: { title: 'With Deps', type: 'feature', depends_on: ['dep-plan'] },
      plansDir: ctx.plansDir,
      graph: ctx.graph,
      projectDir: root,
    }, { refresh: () => {} });

    const readme = readFileSync(join(root, 'plans', 'with-deps', 'README.md'), 'utf8');
    const parsed = matter(readme);
    expect(parsed.data.type).toBe('feature');
    expect(parsed.data.depends_on).toEqual(['dep-plan']);
    expect(parsed.data.status).toBe('draft');
    // Template content should be present
    expect(readme).toContain('## Problem');
    expect(readme).toContain('## Approach');
    expect(existsSync(join(root, 'plans', 'with-deps', 'implementation.md'))).toBe(true);
  });

  it('uses built-in template when projectDir is not provided', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);

    computeCreate({
      id: 'no-project-dir',
      opts: { title: 'No ProjectDir', type: 'investigation' },
      plansDir: ctx.plansDir,
      graph: ctx.graph,
      // projectDir intentionally omitted
    }, { refresh: () => {} });

    const readme = readFileSync(join(root, 'plans', 'no-project-dir', 'README.md'), 'utf8');
    const parsed = matter(readme);
    expect(parsed.data.type).toBe('investigation');
    expect(readme).toContain('## Findings');
    expect(existsSync(join(root, 'plans', 'no-project-dir', 'implementation.md'))).toBe(false);
  });
});

describe('CLI create with --type', () => {
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

  it('creates plan with --type refactor', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    createCommand('my-refactor', { title: 'My Refactor', type: 'refactor' });

    expect(process.exitCode).toBeUndefined();
    expect(logs.join('\n')).toContain('Created plan my-refactor');
    expect(existsSync(join(root, 'plans', 'my-refactor', 'implementation.md'))).toBe(true);
  });

  it('errors on invalid type', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    createCommand('bad', { title: 'Bad', type: 'nonexistent' });

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Unknown template type');
  });

  it('uses default_plan_type from config when --type not specified', () => {
    const { root } = createFixture([]);
    writeFileSync(join(root, '.trellis', 'config'), 'project: test-project\nplans_dir: plans\ndefault_plan_type: bugfix\n');
    process.cwd = () => root;

    createCommand('auto-bugfix', { title: 'Auto Bugfix' });

    expect(process.exitCode).toBeUndefined();
    const readme = readFileSync(join(root, 'plans', 'auto-bugfix', 'README.md'), 'utf8');
    const parsed = matter(readme);
    expect(parsed.data.type).toBe('bugfix');
  });

  it('--type flag overrides default_plan_type', () => {
    const { root } = createFixture([]);
    writeFileSync(join(root, '.trellis', 'config'), 'project: test-project\nplans_dir: plans\ndefault_plan_type: bugfix\n');
    process.cwd = () => root;

    createCommand('override', { title: 'Override', type: 'investigation' });

    expect(process.exitCode).toBeUndefined();
    const readme = readFileSync(join(root, 'plans', 'override', 'README.md'), 'utf8');
    const parsed = matter(readme);
    expect(parsed.data.type).toBe('investigation');
  });
});

describe('init writes templates', () => {
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

  it('fresh init creates template directories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-templates-'));
    process.cwd = () => dir;

    await initCommand({ yes: true });

    expect(existsSync(join(dir, '.trellis', 'templates', 'feature', 'README.md'))).toBe(true);
    expect(existsSync(join(dir, '.trellis', 'templates', 'bugfix', 'README.md'))).toBe(true);
    expect(existsSync(join(dir, '.trellis', 'templates', 'refactor', 'README.md'))).toBe(true);
    expect(existsSync(join(dir, '.trellis', 'templates', 'investigation', 'README.md'))).toBe(true);
    expect(logs.join('\n')).toContain('plan templates');
  });

  it('init does not overwrite existing templates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-templates-'));
    process.cwd = () => dir;

    await initCommand({ yes: true });

    // Modify a template
    const featureReadme = join(dir, '.trellis', 'templates', 'feature', 'README.md');
    writeFileSync(featureReadme, '## Custom\n');

    // Re-run init
    logs = [];
    await initCommand({ yes: true });

    // Custom content should be preserved
    expect(readFileSync(featureReadme, 'utf8')).toBe('## Custom\n');
  });

  it('migration path also writes templates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-templates-'));
    writeFileSync(join(dir, '.trellis'), 'project: test\nplans_dir: plans\n');
    mkdirSync(join(dir, 'plans'), { recursive: true });
    process.cwd = () => dir;

    await initCommand({ yes: true });

    expect(existsSync(join(dir, '.trellis', 'templates', 'feature', 'README.md'))).toBe(true);
    expect(logs.join('\n')).toContain('plan templates');
  });
});

describe('type in set and show', () => {
  it('set type field on existing plan', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    let ctx = createContext(root);

    computeSet({
      planId: 'test',
      field: 'type',
      value: 'investigation',
      mode: 'replace',
      graph: ctx.graph,
    }, { refresh: () => { ctx = createContext(root); } });

    const show = computeShow({ planId: 'test', graph: ctx.graph });
    expect(show?.type).toBe('investigation');
  });

  it('type appears in show --json output', () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    let ctx = createContext(root);

    computeSet({
      planId: 'test',
      field: 'type',
      value: 'bugfix',
      mode: 'replace',
      graph: ctx.graph,
    }, { refresh: () => { ctx = createContext(root); } });

    const show = computeShow({ planId: 'test', graph: ctx.graph });
    const json = JSON.parse(JSON.stringify(show));
    expect(json.type).toBe('bugfix');
  });

  it('type appears in status --json PlanSummary', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);

    computeCreate({
      id: 'typed-plan',
      opts: { title: 'Typed Plan', type: 'feature' },
      plansDir: ctx.plansDir,
      graph: ctx.graph,
      projectDir: root,
    }, { refresh: () => {} });

    const ctx2 = createContext(root);
    const plan = ctx2.plans.find(p => p.id === 'typed-plan');
    expect(plan?.frontmatter.type).toBe('feature');
  });

  it('type flows through computeStatus into JSON output', () => {
    const { root } = createFixture([]);
    const ctx = createContext(root);

    computeCreate({
      id: 'status-type-test',
      opts: { title: 'Status Type Test', type: 'bugfix' },
      plansDir: ctx.plansDir,
      graph: ctx.graph,
      projectDir: root,
    }, { refresh: () => {} });

    const ctx2 = createContext(root);
    const result = computeStatus({
      plans: ctx2.plans,
      config: ctx2.config,
      graph: ctx2.graph,
      filters: { showDone: true, showArchived: true },
    });

    const draftPlans = result.byStatus.draft;
    const typedPlan = draftPlans.find(p => p.id === 'status-type-test');
    expect(typedPlan).toBeDefined();
    expect(typedPlan!.type).toBe('bugfix');
  });
});

describe('MCP trellis_create with type', () => {
  let originalCwd: () => string;

  beforeEach(() => {
    originalCwd = process.cwd;
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it('creates plan with type parameter', async () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_create', {
      id: 'mcp-feature',
      title: 'MCP Feature',
      type: 'feature',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text);
    expect(output.id).toBe('mcp-feature');

    const readme = readFileSync(join(root, 'plans', 'mcp-feature', 'README.md'), 'utf8');
    const parsed = matter(readme);
    expect(parsed.data.type).toBe('feature');
    expect(existsSync(join(root, 'plans', 'mcp-feature', 'implementation.md'))).toBe(true);
  });

  it('creates plan without type uses default from config', async () => {
    const { root } = createFixture([]);
    writeFileSync(join(root, '.trellis', 'config'), 'project: test-project\nplans_dir: plans\ndefault_plan_type: investigation\n');
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_create', {
      id: 'mcp-default',
      title: 'MCP Default',
    });

    expect(result.isError).toBeFalsy();
    const readme = readFileSync(join(root, 'plans', 'mcp-default', 'README.md'), 'utf8');
    const parsed = matter(readme);
    expect(parsed.data.type).toBe('investigation');
    expect(existsSync(join(root, 'plans', 'mcp-default', 'implementation.md'))).toBe(false);
  });

  it('errors on unknown type', async () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_create', {
      id: 'mcp-bad',
      title: 'Bad Type',
      type: 'nonexistent',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown template type');
  });
});

describe('default_plan_type config', () => {
  it('parseConfigContent picks up default_plan_type', () => {
    const { parseConfigContent } = require('./core/scanner.ts');
    const config = parseConfigContent('project: test\nplans_dir: plans\ndefault_plan_type: bugfix\n', '/tmp/test');
    expect(config.default_plan_type).toBe('bugfix');
  });

  it('loadConfig returns default_plan_type', () => {
    const { root } = createFixture([]);
    writeFileSync(join(root, '.trellis', 'config'), 'project: test-project\nplans_dir: plans\ndefault_plan_type: refactor\n');

    const { loadConfig } = require('./core/scanner.ts');
    const config = loadConfig(root);
    expect(config.default_plan_type).toBe('refactor');
  });

  it('loadConfig omits default_plan_type when not configured', () => {
    const { root } = createFixture([]);
    const { loadConfig } = require('./core/scanner.ts');
    const config = loadConfig(root);
    expect(config.default_plan_type).toBeUndefined();
  });
});
