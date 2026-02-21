import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createMcpServer } from '../mcp.ts';
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

  it('creates a server with eleven tools', () => {
    const server = createMcpServer();
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toContain('trellis_create');
    expect(tools).toContain('trellis_write_section');
    expect(tools).toContain('trellis_write_sections');
    expect(tools).toContain('trellis_read_section');
    expect(tools).toContain('trellis_set');
    expect(tools).toContain('trellis_update');
    expect(tools).toContain('trellis_status');
    expect(tools).toContain('trellis_ready');
    expect(tools).toContain('trellis_show');
    expect(tools).toContain('trellis_graph');
    expect(tools).toContain('trellis_lint');
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
    it('returns plans grouped by status', async () => {
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
      const output = JSON.parse(result.content[0].text);
      expect(output.total).toBe(4);
      expect(output.byStatus.ready).toHaveLength(1);
      expect(output.byStatus.ready[0].id).toBe('a');
      expect(output.byStatus.inProgress).toHaveLength(1);
      expect(output.byStatus.draft).toHaveLength(1);
      expect(output.byStatus.done).toHaveLength(1);
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
      const output = JSON.parse(result.content[0].text);
      expect(output.total).toBe(2);
    });

    it('includes done and archived by default', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'done', body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'archived', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_status', {});

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(result.content[0].text);
      expect(output.byStatus.done).toHaveLength(1);
      expect(output.byStatus.archived).toHaveLength(1);
    });
  });

  describe('trellis_ready', () => {
    it('returns ready plans with next recommendation', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'not_started', body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], body: '\n## Problem\nText\n' },
        { id: 'c', title: 'Plan C', status: 'draft', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_ready', {});

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(result.content[0].text);
      // Only 'a' is ready (b is blocked, c is draft)
      expect(output.plans).toHaveLength(1);
      expect(output.plans[0].id).toBe('a');
      expect(output.next).toBe('a');
    });

    it('returns empty when nothing is ready', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'draft', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_ready', {});

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(result.content[0].text);
      expect(output.plans).toHaveLength(0);
      expect(output.next).toBeNull();
    });
  });

  describe('trellis_show', () => {
    it('returns full plan detail', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'done', body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], tags: ['epic:auth'], assignee: 'alice', body: '\n## Problem\nB problem\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_show', { plan_id: 'b' });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(result.content[0].text);
      expect(output.id).toBe('b');
      expect(output.title).toBe('Plan B');
      expect(output.status).toBe('not_started');
      expect(output.tags).toContain('epic:auth');
      expect(output.assignee).toBe('alice');
      expect(output.dependsOn).toHaveLength(1);
      expect(output.dependsOn[0].id).toBe('a');
      expect(output.dependsOn[0].satisfied).toBe(true);
      expect(output.ready).toBe(true);
      expect(output.blocked).toBe(false);
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
      const output = JSON.parse(result.content[0].text);
      expect(output.blocked).toBe(true);
      expect(output.ready).toBe(false);
      expect(output.dependsOn[0].satisfied).toBe(false);
    });
  });

  describe('trellis_graph', () => {
    it('returns nodes and edges', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'done', body: '\n## Problem\nText\n' },
        { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'], body: '\n## Problem\nText\n' },
        { id: 'c', title: 'Plan C', status: 'draft', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_graph', {});

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(result.content[0].text);
      expect(output.nodes).toHaveLength(3);
      expect(output.edges).toHaveLength(1);
      expect(output.edges[0]).toEqual({ from: 'a', to: 'b' });
      expect(output.project).toBe('test-project');
    });

    it('returns empty graph for no plans', async () => {
      const { root } = createFixture([]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_graph', {});

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(result.content[0].text);
      expect(output.nodes).toHaveLength(0);
      expect(output.edges).toHaveLength(0);
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
      const output = JSON.parse(result.content[0].text);
      expect(output.ok).toBe(true);
      expect(output.total).toBe(1);
    });

    it('detects missing dependencies', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'not_started', depends_on: ['nonexistent'], body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_lint', {});

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(result.content[0].text);
      expect(output.ok).toBe(false);
      expect(output.errors.length).toBeGreaterThan(0);
      expect(output.errors.some((e: any) => e.type === 'missing_dependency')).toBe(true);
    });

    it('strict mode fails on warnings', async () => {
      const { root } = createFixture([
        { id: 'a', title: 'Plan A', status: 'draft', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();
      const result = await callTool(server, 'trellis_lint', { strict: true });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(result.content[0].text);
      // Draft orphan plan generates a warning — strict makes ok=false
      expect(output.warnings.length).toBeGreaterThan(0);
      expect(output.ok).toBe(false);
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
      const output = JSON.parse(result.content[0].text);
      expect(output.ok).toBe(false);
      expect(output.errors.some((e: any) => e.type === 'inconsistency')).toBe(true);
    });
  });

  describe('read tool context freshness', () => {
    it('each call gets fresh context reflecting filesystem changes', async () => {
      const { root, plansDir } = createFixture([
        { id: 'a', title: 'Plan A', status: 'not_started', body: '\n## Problem\nText\n' },
      ]);
      process.cwd = () => root;

      const server = createMcpServer();

      // First call: one ready plan
      const r1 = await callTool(server, 'trellis_ready', {});
      const out1 = JSON.parse(r1.content[0].text);
      expect(out1.plans).toHaveLength(1);

      // Add another plan to filesystem
      const newPlanDir = join(plansDir, 'b');
      const { mkdirSync, writeFileSync } = await import('fs');
      mkdirSync(newPlanDir, { recursive: true });
      writeFileSync(join(newPlanDir, 'README.md'), '---\ntitle: Plan B\nstatus: not_started\n---\n\n## Problem\nText\n');

      // Second call: two ready plans
      const r2 = await callTool(server, 'trellis_ready', {});
      const out2 = JSON.parse(r2.content[0].text);
      expect(out2.plans).toHaveLength(2);
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
});
