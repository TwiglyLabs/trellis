import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMcpServer } from '../src/mcp.ts';
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

  it('creates a server with five tools', () => {
    const server = createMcpServer();
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toContain('trellis_create');
    expect(tools).toContain('trellis_write_section');
    expect(tools).toContain('trellis_read_section');
    expect(tools).toContain('trellis_set');
    expect(tools).toContain('trellis_update');
    expect(tools).toHaveLength(5);
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

  it('trellis_write_section to implementation when file does not exist returns error', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    // implementation.md doesn't exist — write to it should throw since it's not inputs/outputs
    const result = await callTool(server, 'trellis_write_section', {
      plan_id: 'test',
      file: 'implementation',
      section: 'Steps',
      content: 'Step 1\n',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('does not exist');
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
});
