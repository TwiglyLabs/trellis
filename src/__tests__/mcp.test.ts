import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createMcpServer } from '../mcp.ts';
import { ContextStore } from '../core/store.ts';
import { createFixture } from './helpers.ts';

// Helper to call a tool handler directly on the McpServer
async function callTool(server: any, name: string, args: Record<string, any>) {
  const tool = server._registeredTools[name];
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  // The handler signature is (args, extra) -> CallToolResult
  return tool.handler(args, {});
}

describe('MCP server', () => {
  let originalCwd: () => string;

  beforeEach(() => {
    originalCwd = process.cwd;
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it('creates a server with eleven tools (trellis_ready removed)', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    const server = createMcpServer();
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toContain('trellis_create');
    expect(tools).toContain('trellis_write_section');
    expect(tools).toContain('trellis_write_sections');
    expect(tools).toContain('trellis_read_section');
    expect(tools).toContain('trellis_set');
    expect(tools).toContain('trellis_update');
    expect(tools).toContain('trellis_status');
    expect(tools).not.toContain('trellis_ready');
    expect(tools).toContain('trellis_show');
    expect(tools).toContain('trellis_graph');
    expect(tools).toContain('trellis_lint');
    expect(tools).toContain('trellis_bottlenecks');
    expect(tools).toHaveLength(11);
  });

  it('trellis_create creates a plan', async () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_create', { id: 'new-plan', title: 'New Plan' });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text);
    expect(output.id).toBe('new-plan');
  });

  it('trellis_create rejects duplicate IDs', async () => {
    const { root } = createFixture([
      { id: 'existing', title: 'Existing', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_create', { id: 'existing', title: 'Dup' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('already exists');
  });

  it('trellis_write_section writes to a plan', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nOld text\n## Approach\nOld approach\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_write_section', {
      plan_id: 'test', file: 'readme', section: 'Problem', content: 'New problem\n',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text);
    expect(output.section).toBe('Problem');
  });

  it('trellis_read_section reads plan content', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nSome text\n## Approach\nFix it\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_read_section', {
      plan_id: 'test', file: 'readme', section: 'Problem',
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Some text');
  });

  it('trellis_set updates frontmatter', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_set', {
      plan_id: 'test', field: 'description', value: 'Updated desc',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text);
    expect(output.field).toBe('description');
    expect(output.value).toBe('Updated desc');
  });

  it('trellis_set rejects status field', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_set', {
      plan_id: 'test', field: 'status', value: 'done',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('status');
  });

  it('trellis_update transitions status', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_update', {
      plan_id: 'test', status: 'not_started', force: true,
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text);
    expect(output.previous_status).toBe('draft');
    expect(output.status).toBe('not_started');
  });

  it('trellis_update enforces gates without force', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_update', {
      plan_id: 'test', status: 'not_started',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cannot transition');
  });

  it('trellis_read_section errors when section specified without file', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_read_section', {
      plan_id: 'test', section: 'Problem',
    });

    expect(result.isError).toBe(true);
  });

  it('trellis_create with all optional fields', async () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_create', {
      id: 'full-plan',
      title: 'Full Plan',
      description: 'A plan with all optional fields',
      depends_on: [],
      tags: ['foundation', 'public'],
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text);
    expect(output.id).toBe('full-plan');
  });

  it('trellis_write_section with nonexistent plan returns error', async () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_write_section', {
      plan_id: 'nonexistent',
      file: 'readme',
      section: 'Problem',
      content: 'Some content\n',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('trellis_write_section creates implementation file when it does not exist', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_write_section', {
      plan_id: 'test',
      file: 'implementation',
      section: 'Steps',
      content: 'Step 1\n',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text);
    expect(output.section).toBe('Steps');
    const content = readFileSync(join(root, 'plans', 'test', 'implementation.md'), 'utf8');
    expect(content).toContain('Step 1');
  });

  it('trellis_read_section whole plan mode strips frontmatter', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nSome content\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_read_section', {
      plan_id: 'test',
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).not.toContain('title:');
    expect(result.content[0].text).toContain('Problem');
  });

  it('trellis_read_section with nonexistent plan returns error', async () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_read_section', {
      plan_id: 'nonexistent',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('trellis_read_section with missing file returns error', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_read_section', {
      plan_id: 'test',
      file: 'outputs',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('does not exist');
  });

  it('trellis_set with add mode', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['a'], body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_set', {
      plan_id: 'test',
      field: 'tags',
      value: ['b'],
      mode: 'add',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text);
    expect(output.field).toBe('tags');
    expect(output.value).toContain('b');
  });

  it('trellis_set with remove mode', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', tags: ['a', 'b'], body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_set', {
      plan_id: 'test',
      field: 'tags',
      value: ['a'],
      mode: 'remove',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text);
    expect(output.field).toBe('tags');
    expect(output.value).not.toContain('a');
    expect(output.value).toContain('b');
  });

  it('trellis_update with nonexistent plan returns error', async () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_update', {
      plan_id: 'ghost',
      status: 'in_progress',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('trellis_update backward transition with force clears timestamps', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'in_progress', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_update', {
      plan_id: 'test',
      status: 'draft',
      force: true,
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text);
    expect(output.previous_status).toBe('in_progress');
    expect(output.status).toBe('draft');
  });

  describe('trellis_write_sections', () => {
    it('writes multiple sections to a plan', async () => {
      const { root } = createFixture([
        { id: 'test', title: 'Test', status: 'draft',
          body: '\n## Problem\n\n\n## Approach\n\n\n' },
      ]);
      process.cwd = () => root;
      const server = createMcpServer();

      const result = await callTool(server, 'trellis_write_sections', {
        plan_id: 'test',
        writes: [
          { file: 'readme', section: 'Problem', content: 'Batch problem' },
          { file: 'readme', section: 'Approach', content: 'Batch approach' },
        ],
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(result.content[0].text);
      expect(output.id).toBe('test');
      expect(output.writes).toHaveLength(2);

      const content = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
      expect(content).toContain('Batch problem');
      expect(content).toContain('Batch approach');
    });

    it('writes to multiple files atomically', async () => {
      const { root } = createFixture([
        { id: 'test', title: 'Test', status: 'draft',
          body: '\n## Problem\nOld\n',
          implementationMd: '## Steps\nOld\n## Testing\nOld\n' },
      ]);
      process.cwd = () => root;
      const server = createMcpServer();

      const result = await callTool(server, 'trellis_write_sections', {
        plan_id: 'test',
        writes: [
          { file: 'readme', section: 'Problem', content: 'New problem' },
          { file: 'implementation', section: 'Steps', content: 'Step 1\nStep 2' },
          { file: 'implementation', section: 'Testing', content: 'Test plan' },
        ],
      });

      expect(result.isError).toBeFalsy();

      const readme = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
      expect(readme).toContain('New problem');

      const impl = readFileSync(join(root, 'plans', 'test', 'implementation.md'), 'utf8');
      expect(impl).toContain('Step 1\nStep 2');
      expect(impl).toContain('Test plan');
    });

    it('returns error for non-existent plan', async () => {
      const { root } = createFixture([]);
      process.cwd = () => root;
      const server = createMcpServer();

      const result = await callTool(server, 'trellis_write_sections', {
        plan_id: 'nope',
        writes: [{ file: 'readme', section: 'Problem', content: 'X' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });
  });

  // --- Read tools ---

  describe('trellis_status', () => {
    it('returns plans grouped by status as text', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'not_started', body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'in_progress', body: '\n## Problem\nText\n' },
        { id: 'c', title: 'Plan C', status: 'draft', body: '\n## Problem\nText\n' },
        { id: 'd', title: 'Plan D', status: 'done', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_status', {});

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('(4 plans)');
      expect(text).toContain('## Ready (1)');
      expect(text).toContain('- a: Plan A');
      expect(text).toContain('## In Progress (1)');
      expect(text).toContain('- b: Plan B');
      expect(text).toContain('## Draft (1)');
      expect(text).toContain('## Done (1)');
      expect(text).toContain('Next: a');
    });

    it('filters by tag', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'not_started', tags: ['epic:auth'], body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'in_progress', tags: ['epic:auth'], body: '\n## Problem\nText\n' },
        { id: 'c', title: 'Plan C', status: 'draft', tags: ['epic:payments'], body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_status', { tag: 'epic:auth' });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('(2 plans)');
      expect(text).toContain('(tag: epic:auth)');
      expect(text).not.toContain('Plan C');
    });

    it('shows done plans as comma-separated IDs, omits archived', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'done', body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'archived', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_status', {});

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('## Done (1)');
      // Archived omitted entirely from text output
      expect(text).not.toContain('Archived');
    });
  });

  describe('trellis_ready (removed)', () => {
    it('trellis_ready tool is not registered', () => {
      const { root } = createFixture([]);
      process.cwd = () => root;

      const server = createMcpServer();
      const tools = Object.keys((server as any)._registeredTools);
      expect(tools).not.toContain('trellis_ready');
    });

    it('next recommendation is included in trellis_status', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'not_started', body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_status', {});

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('Next: a');
    });
  });

  describe('trellis_show', () => {
    it('returns plan detail as text', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'done', body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], tags: ['epic:auth'], assignee: 'alice', body: '\n## Problem\nB problem\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_show', { plan_id: 'b' });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('# Plan B (b)');
      expect(text).toContain('Status: not_started (ready)');
      expect(text).toContain('Tags: epic:auth');
      expect(text).toContain('Assignee: alice');
      expect(text).toContain('## Dependencies');
      expect(text).toContain('✓ a (done)');
    });

    it('returns error for nonexistent plan', async () => {
      const { root } = createFixture([]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_show', { plan_id: 'ghost' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    it('shows blocked status when deps are incomplete', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'in_progress', body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_show', { plan_id: 'b' });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('(blocked)');
      expect(text).toContain('○ a (in_progress)');
    });
  });

  describe('trellis_graph', () => {
    it('returns edges as text', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'done', body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], body: '\n## Problem\nText\n' },
        { id: 'c', title: 'Plan C', status: 'draft', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_graph', {});

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('# test-project dependency graph');
      expect(text).toContain('## Edges');
      expect(text).toContain('a → b');
    });

    it('returns header-only for no plans', async () => {
      const { root } = createFixture([]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_graph', {});

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('dependency graph');
      expect(text).not.toContain('## Edges');
    });
  });

  describe('trellis_lint', () => {
    it('returns ok for valid plans', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'draft', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_lint', {});

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('ok: true');
    });

    it('detects missing dependencies', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'not_started', depends_on: ['nonexistent'], body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_lint', {});

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('ok: false');
      expect(text).toContain('## Errors');
      expect(text).toContain('a:');
    });

    it('strict mode fails on warnings', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'draft', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_lint', { strict: true });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('## Warnings');
      expect(text).toContain('ok: false');
    });

    it('detects inconsistency: done plan with incomplete dep', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'in_progress', body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'done', depends_on: ['a'], body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_lint', {});

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('ok: false');
      expect(text).toContain('## Errors');
    });
  });

  describe('write-then-read consistency', () => {
    it('write tool creates plan → immediate status reflects the change', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'not_started', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();

      // First call: one ready plan
      const r1 = await callTool(server, 'trellis_status', {});
      expect(r1.content[0].text).toContain('## Ready (1)');

      // Create a new plan via write tool (triggers invalidation)
      const createResult = await callTool(server, 'trellis_create', { id: 'b', title: 'Plan B' });
      expect(createResult.isError).toBeFalsy();

      // Update the new plan's status to not_started so it shows up as ready
      const updateResult = await callTool(server, 'trellis_update', {
        plan_id: 'b', status: 'not_started', force: true,
      });
      expect(updateResult.isError).toBeFalsy();

      // Immediate read: should see both plans as ready (no stale data)
      const r2 = await callTool(server, 'trellis_status', {});
      expect(r2.content[0].text).toContain('## Ready (2)');
    });

    it('write tool modifies plan → immediate show reflects the change', async () => {
      const { root } = createFixture([
        { id: 'test', title: 'Original Title', status: 'draft', body: '\n## Problem\nOriginal\n## Approach\nOriginal\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();

      // Write a section
      const writeResult = await callTool(server, 'trellis_write_section', {
        plan_id: 'test', file: 'readme', section: 'Problem', content: 'Updated problem\n',
      });
      expect(writeResult.isError).toBeFalsy();

      // Immediate read should reflect the write
      const readResult = await callTool(server, 'trellis_read_section', {
        plan_id: 'test', file: 'readme', section: 'Problem',
      });
      expect(readResult.content[0].text).toContain('Updated problem');
    });
  });

  describe('concurrent write safety', () => {
    it('parallel writes to the same file all persist', async () => {
      const { root } = createFixture([
        { id: 'test', title: 'Test', status: 'draft',
          body: '\n## Problem\n\n\n## Approach\n\n\n## Notes\n\n\n' },
      ]);
      process.cwd = () => root;
      const server = createMcpServer();

      const [r1, r2, r3] = await Promise.all([
        callTool(server, 'trellis_write_section', {
          plan_id: 'test', file: 'readme', section: 'Problem', content: 'Problem content',
        }),
        callTool(server, 'trellis_write_section', {
          plan_id: 'test', file: 'readme', section: 'Approach', content: 'Approach content',
        }),
        callTool(server, 'trellis_write_section', {
          plan_id: 'test', file: 'readme', section: 'Notes', content: 'Notes content',
        }),
      ]);

      expect(r1.isError).toBeFalsy();
      expect(r2.isError).toBeFalsy();
      expect(r3.isError).toBeFalsy();

      const content = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
      expect(content).toContain('Problem content');
      expect(content).toContain('Approach content');
      expect(content).toContain('Notes content');
    });

    it('parallel writes to different files both persist', async () => {
      const { root } = createFixture([
        { id: 'test', title: 'Test', status: 'draft',
          body: '\n## Problem\nOld\n',
          implementationMd: '## Steps\nOld\n' },
      ]);
      process.cwd = () => root;
      const server = createMcpServer();

      const [r1, r2] = await Promise.all([
        callTool(server, 'trellis_write_section', {
          plan_id: 'test', file: 'readme', section: 'Problem', content: 'New problem',
        }),
        callTool(server, 'trellis_write_section', {
          plan_id: 'test', file: 'implementation', section: 'Steps', content: 'New steps',
        }),
      ]);

      expect(r1.isError).toBeFalsy();
      expect(r2.isError).toBeFalsy();

      const readme = readFileSync(join(root, 'plans', 'test', 'README.md'), 'utf8');
      expect(readme).toContain('New problem');

      const impl = readFileSync(join(root, 'plans', 'test', 'implementation.md'), 'utf8');
      expect(impl).toContain('New steps');
    });
  });

  describe('context caching behavior', () => {
    it('store.get() returns in < 1ms after initial load (read tools are fast)', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'not_started', body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'draft', body: '\n## Problem\nText\n' },
        { id: 'c', title: 'Plan C', status: 'done', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();

      // Warm up with first call (triggers store.load if not already done)
      await callTool(server, 'trellis_status', {});

      // Subsequent reads should be fast (cached)
      const start = performance.now();
      await callTool(server, 'trellis_status', {});
      await callTool(server, 'trellis_show', { plan_id: 'a' });
      await callTool(server, 'trellis_graph', {});
      const elapsed = performance.now() - start;

      // 3 read calls should complete well under 50ms total with caching
      expect(elapsed).toBeLessThan(50);
    });

    it('write tool triggers invalidation → subsequent read reflects change', async () => {
      const { root } = createFixture([
        { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nOld problem\n## Approach\nOld approach\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();

      // Verify initial state
      const r1 = await callTool(server, 'trellis_show', { plan_id: 'test' });
      expect(r1.content[0].text).toContain('# Test (test)');

      // Update description via set tool
      const setResult = await callTool(server, 'trellis_set', {
        plan_id: 'test', field: 'description', value: 'Updated description',
      });
      expect(setResult.isError).toBeFalsy();

      // Immediate read should reflect the change
      const r2 = await callTool(server, 'trellis_show', { plan_id: 'test' });
      expect(r2.content[0].text).toContain('Updated description');
    });

    it('status transition via write tool is immediately visible in status view', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'not_started', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();

      // Initially: one ready plan
      const r1 = await callTool(server, 'trellis_status', {});
      expect(r1.content[0].text).toContain('## Ready (1)');
      expect(r1.content[0].text).not.toContain('## In Progress');

      // Transition to in_progress (force=true to bypass gate checks)
      const updateResult = await callTool(server, 'trellis_update', {
        plan_id: 'a', status: 'in_progress', force: true,
      });
      expect(updateResult.isError).toBeFalsy();

      // Immediately: should show in_progress, not ready
      const r2 = await callTool(server, 'trellis_status', {});
      expect(r2.content[0].text).not.toContain('## Ready');
      expect(r2.content[0].text).toContain('## In Progress (1)');
    });

    it('multiple sequential writes all reflect in subsequent read', async () => {
      const { root } = createFixture([]);
      process.cwd = () => root;

      const server = createMcpServer();

      // Create 3 plans sequentially
      for (let i = 0; i < 3; i++) {
        const result = await callTool(server, 'trellis_create', {
          id: `plan-${i}`, title: `Plan ${i}`,
        });
        expect(result.isError).toBeFalsy();
      }

      // All 3 should be visible
      const r = await callTool(server, 'trellis_status', {});
      expect(r.content[0].text).toContain('(3 plans)');
    });

    it('read tools use cached context (no rescan between reads)', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'not_started', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();

      // Spy on scanPlans to verify no rescans happen on pure reads
      const scanSpy = vi.spyOn(await import('../core/scanner.ts'), 'scanPlans');

      // Multiple read calls — none should trigger a rescan
      await callTool(server, 'trellis_status', {});
      await callTool(server, 'trellis_show', { plan_id: 'a' });
      await callTool(server, 'trellis_graph', {});
      await callTool(server, 'trellis_lint', {});
      await callTool(server, 'trellis_bottlenecks', {});

      expect(scanSpy).not.toHaveBeenCalled();
      scanSpy.mockRestore();
    });
  });

  describe('persist-after-write', () => {
    it('write tool calls store.persist() after mutation', async () => {
      const { root } = createFixture([
        { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n## Approach\nText\n' },
      ]);
      process.cwd = () => root;

      const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-persist-test-'));
      const store = new ContextStore({
        repos: [{ path: root, alias: 'test-project' }],
        cacheDir,
        qualifyIds: false,
      });
      store.load();

      const persistSpy = vi.spyOn(store, 'persist');

      const server = createMcpServer({
        _storeBundle: { store, isMultiRepo: false, singleRepoProjectDir: root },
      });

      // Write a section
      await callTool(server, 'trellis_write_section', {
        plan_id: 'test', file: 'readme', section: 'Problem', content: 'Updated\n',
      });

      expect(persistSpy).toHaveBeenCalledTimes(1);
      persistSpy.mockRestore();
    });

    it('each write tool invocation calls persist()', async () => {
      const { root } = createFixture([
        { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n## Approach\nText\n' },
      ]);
      process.cwd = () => root;

      const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-persist-test-'));
      const store = new ContextStore({
        repos: [{ path: root, alias: 'test-project' }],
        cacheDir,
        qualifyIds: false,
      });
      store.load();

      const persistSpy = vi.spyOn(store, 'persist');

      const server = createMcpServer({
        _storeBundle: { store, isMultiRepo: false, singleRepoProjectDir: root },
      });

      // Multiple write operations
      await callTool(server, 'trellis_set', {
        plan_id: 'test', field: 'description', value: 'desc',
      });
      await callTool(server, 'trellis_update', {
        plan_id: 'test', status: 'not_started', force: true,
      });
      await callTool(server, 'trellis_create', {
        id: 'new-plan', title: 'New Plan',
      });

      expect(persistSpy).toHaveBeenCalledTimes(3);
      persistSpy.mockRestore();
    });

    it('invalidate() is called before persist() on write', async () => {
      const { root } = createFixture([
        { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n## Approach\nText\n' },
      ]);
      process.cwd = () => root;

      const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-persist-test-'));
      const store = new ContextStore({
        repos: [{ path: root, alias: 'test-project' }],
        cacheDir,
        qualifyIds: false,
      });
      store.load();

      const callOrder: string[] = [];
      const invalidateSpy = vi.spyOn(store, 'invalidate').mockImplementation((...args) => {
        callOrder.push('invalidate');
        // Call through to original
        return (ContextStore.prototype.invalidate as any).apply(store, args);
      });
      const persistSpy = vi.spyOn(store, 'persist').mockImplementation(async () => {
        callOrder.push('persist');
      });

      const server = createMcpServer({
        _storeBundle: { store, isMultiRepo: false, singleRepoProjectDir: root },
      });

      await callTool(server, 'trellis_write_section', {
        plan_id: 'test', file: 'readme', section: 'Problem', content: 'Updated\n',
      });

      expect(callOrder).toEqual(['invalidate', 'persist']);
      invalidateSpy.mockRestore();
      persistSpy.mockRestore();
    });
  });

  describe('cross-boundary MCP→CLI shared index', () => {
    it('MCP persists index → fresh ContextStore reads it correctly', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'not_started', body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-cross-'));
      const mcpStore = new ContextStore({
        repos: [{ path: root, alias: 'test-project' }],
        cacheDir,
        qualifyIds: false,
      });
      mcpStore.load();

      const server = createMcpServer({
        _storeBundle: { store: mcpStore, isMultiRepo: false, singleRepoProjectDir: root },
      });

      // Write via MCP tool
      await callTool(server, 'trellis_update', {
        plan_id: 'a', status: 'done', force: true,
      });

      // Persist like MCP server does on shutdown
      await mcpStore.persist();

      // Simulate CLI: new ContextStore reads the persisted index
      const cliStore = new ContextStore({
        repos: [{ path: root, alias: 'test-project' }],
        cacheDir,
        qualifyIds: false,
      });
      const cliCtx = cliStore.load();

      // CLI should see the updated status from MCP's write
      const planA = cliCtx.plans.find(p => p.id === 'a');
      expect(planA?.frontmatter.status).toBe('done');

      // Graph should reflect the change too
      expect(cliCtx.graph.ready.has('b')).toBe(true);
    });

    it('MCP creates plan → CLI sees it via shared index', async () => {
      const { root } = createFixture([]);
      process.cwd = () => root;

      const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-cross-'));
      const mcpStore = new ContextStore({
        repos: [{ path: root, alias: 'test-project' }],
        cacheDir,
        qualifyIds: false,
      });
      mcpStore.load();

      const server = createMcpServer({
        _storeBundle: { store: mcpStore, isMultiRepo: false, singleRepoProjectDir: root },
      });

      // Create via MCP
      await callTool(server, 'trellis_create', { id: 'new-plan', title: 'New Plan' });
      await mcpStore.persist();

      // CLI reads the shared index
      const cliStore = new ContextStore({
        repos: [{ path: root, alias: 'test-project' }],
        cacheDir,
        qualifyIds: false,
      });
      const cliCtx = cliStore.load();

      expect(cliCtx.plans.length).toBe(1);
      expect(cliCtx.plans[0].id).toBe('new-plan');
    });

    it('CLI writes plan file directly → MCP invalidate detects change', async () => {
      const { root, plansDir } = createFixture([
        { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-cross-'));
      const mcpStore = new ContextStore({
        repos: [{ path: root, alias: 'test-project' }],
        cacheDir,
        qualifyIds: false,
      });
      mcpStore.load();

      // Verify initial state
      expect(mcpStore.get().plans.length).toBe(1);

      // Simulate CLI writing a plan file directly (bypassing MCP)
      const newPlanDir = join(plansDir, 'cli-plan');
      mkdirSync(newPlanDir, { recursive: true });
      writeFileSync(
        join(newPlanDir, 'README.md'),
        '---\ntitle: CLI Plan\nstatus: not_started\n---\n\n## Problem\nFrom CLI\n',
      );

      // MCP invalidates (as it would on watch event)
      mcpStore.invalidate('test-project');

      // MCP now sees the CLI-created plan
      const ctx = mcpStore.get();
      expect(ctx.plans.length).toBe(2);
      expect(ctx.plans.some(p => p.id === 'cli-plan')).toBe(true);
    });
  });
});
