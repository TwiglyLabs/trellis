import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createMcpServer, parseReposFlag, loadProjectRepos } from '../mcp.ts';
import { resolvePlanId, buildGraph, createMultiContext } from '../core/index.ts';
import { createFixture } from './helpers.ts';
import type { Plan } from '../core/types.ts';

// Helper to call a tool handler directly on the McpServer
async function callTool(server: any, name: string, args: Record<string, any>) {
  const tool = server._registeredTools[name];
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  return tool.handler(args, {});
}

// =============================================
// parseReposFlag
// =============================================

describe('parseReposFlag', () => {
  it('parses valid alias=path pairs', () => {
    const { root: root1 } = createFixture([]);
    const { root: root2 } = createFixture([]);

    const specs = parseReposFlag(`alpha=${root1},beta=${root2}`);
    expect(specs).toHaveLength(2);
    expect(specs[0].alias).toBe('alpha');
    expect(specs[0].path).toBe(root1);
    expect(specs[1].alias).toBe('beta');
    expect(specs[1].path).toBe(root2);
  });

  it('throws on missing equals sign', () => {
    expect(() => parseReposFlag('bad-input')).toThrow('expected alias=path');
  });

  it('throws on empty alias', () => {
    const { root } = createFixture([]);
    expect(() => parseReposFlag(`=${root}`)).toThrow('Empty alias');
  });

  it('throws on invalid alias characters', () => {
    const { root } = createFixture([]);
    expect(() => parseReposFlag(`123bad=${root}`)).toThrow('Invalid alias');
  });

  it('throws on duplicate aliases', () => {
    const { root } = createFixture([]);
    expect(() => parseReposFlag(`a=${root},a=${root}`)).toThrow('Duplicate alias');
  });

  it('throws on non-existent paths', () => {
    expect(() => parseReposFlag('a=/nonexistent/path')).toThrow('Path does not exist');
  });

  it('throws on empty input', () => {
    expect(() => parseReposFlag('')).toThrow('No repo specs');
  });

  it('handles whitespace in pairs', () => {
    const { root } = createFixture([]);
    const specs = parseReposFlag(` alpha = ${root} `);
    expect(specs[0].alias).toBe('alpha');
    expect(specs[0].path).toBe(root);
  });
});

// =============================================
// loadProjectRepos
// =============================================

describe('loadProjectRepos', () => {
  it('loads repos with path field from manifest', () => {
    const { root: repo1 } = createFixture([]);
    const { root: repo2 } = createFixture([]);
    const { root: projectDir } = createFixture([]);

    const manifest = [
      'name: test-project',
      'repos:',
      '  alpha:',
      `    path: ${repo1}`,
      '    url: https://github.com/org/alpha.git',
      '    branch: main',
      '    visibility: public',
      '  beta:',
      `    path: ${repo2}`,
      '    url: https://github.com/org/beta.git',
      '    branch: main',
      '    visibility: private',
    ].join('\n');

    const { writeFileSync: wfs } = require('fs');
    wfs(join(projectDir, '.trellis-project'), manifest);

    const specs = loadProjectRepos(projectDir);
    expect(specs).toHaveLength(2);
    expect(specs[0].alias).toBe('alpha');
    expect(specs[0].path).toBe(repo1);
    expect(specs[1].alias).toBe('beta');
    expect(specs[1].path).toBe(repo2);
  });

  it('skips repos without path field', () => {
    const { root: repo1 } = createFixture([]);
    const { root: projectDir } = createFixture([]);

    const manifest = [
      'name: test-project',
      'repos:',
      '  alpha:',
      `    path: ${repo1}`,
      '    url: https://github.com/org/alpha.git',
      '    branch: main',
      '    visibility: public',
      '  remote-only:',
      '    url: https://github.com/org/remote.git',
      '    branch: main',
      '    visibility: public',
    ].join('\n');

    const { writeFileSync: wfs } = require('fs');
    wfs(join(projectDir, '.trellis-project'), manifest);

    const specs = loadProjectRepos(projectDir);
    expect(specs).toHaveLength(1);
    expect(specs[0].alias).toBe('alpha');
  });

  it('throws when no manifest exists', () => {
    const { root } = createFixture([]);
    expect(() => loadProjectRepos(root)).toThrow('No .trellis-project manifest');
  });

  it('throws when no repos have path', () => {
    const { root: projectDir } = createFixture([]);

    const manifest = [
      'name: test-project',
      'repos:',
      '  remote-only:',
      '    url: https://github.com/org/remote.git',
      '    branch: main',
      '    visibility: public',
    ].join('\n');

    const { writeFileSync: wfs } = require('fs');
    wfs(join(projectDir, '.trellis-project'), manifest);

    expect(() => loadProjectRepos(projectDir)).toThrow('No repos with local "path"');
  });

  it('throws when path in manifest does not exist', () => {
    const { root: projectDir } = createFixture([]);

    const manifest = [
      'name: test-project',
      'repos:',
      '  bad-repo:',
      '    path: /nonexistent/path/to/repo',
    ].join('\n');

    const { writeFileSync: wfs } = require('fs');
    wfs(join(projectDir, '.trellis-project'), manifest);

    expect(() => loadProjectRepos(projectDir)).toThrow('Path does not exist');
    expect(() => loadProjectRepos(projectDir)).toThrow('bad-repo');
  });

  it('supports path-only entries (no url)', () => {
    const { root: repo1 } = createFixture([]);
    const { root: projectDir } = createFixture([]);

    const manifest = [
      'name: test-project',
      'repos:',
      '  local-only:',
      `    path: ${repo1}`,
    ].join('\n');

    const { writeFileSync: wfs } = require('fs');
    wfs(join(projectDir, '.trellis-project'), manifest);

    const specs = loadProjectRepos(projectDir);
    expect(specs).toHaveLength(1);
    expect(specs[0].alias).toBe('local-only');
    expect(specs[0].path).toBe(repo1);
  });
});

// =============================================
// resolvePlanId
// =============================================

describe('resolvePlanId', () => {
  function makePlan(id: string, alias?: string): Plan {
    return {
      id,
      filePath: `plans/${id}/README.md`,
      frontmatter: { title: `Plan ${id}`, status: 'not_started' },
      body: '',
      lineCount: 10,
      updatedAt: new Date(),
      fileHashes: {},
      repoAlias: alias,
    };
  }

  it('resolves a qualified ID that exists', () => {
    const plans = [makePlan('alpha:auth', 'alpha')];
    const graph = buildGraph(plans);

    const result = resolvePlanId(graph, 'alpha:auth');
    expect(result.qualifiedId).toBe('alpha:auth');
    expect(result.alias).toBe('alpha');
    expect(result.localId).toBe('auth');
  });

  it('resolves an unqualified ID when unique', () => {
    const plans = [makePlan('alpha:auth', 'alpha')];
    const graph = buildGraph(plans);

    const result = resolvePlanId(graph, 'auth');
    expect(result.qualifiedId).toBe('alpha:auth');
    expect(result.alias).toBe('alpha');
    expect(result.localId).toBe('auth');
  });

  it('throws on ambiguous unqualified ID', () => {
    const plans = [
      makePlan('alpha:auth', 'alpha'),
      makePlan('beta:auth', 'beta'),
    ];
    const graph = buildGraph(plans);

    expect(() => resolvePlanId(graph, 'auth')).toThrow('Ambiguous plan ID');
  });

  it('throws on not-found qualified ID', () => {
    const plans = [makePlan('alpha:auth', 'alpha')];
    const graph = buildGraph(plans);

    expect(() => resolvePlanId(graph, 'alpha:nonexistent')).toThrow('not found');
  });

  it('throws on not-found unqualified ID', () => {
    const plans = [makePlan('alpha:auth', 'alpha')];
    const graph = buildGraph(plans);

    expect(() => resolvePlanId(graph, 'nonexistent')).toThrow('not found');
  });

  it('works with unqualified IDs in single-repo graph', () => {
    const plans = [makePlan('auth')];
    const graph = buildGraph(plans);

    const result = resolvePlanId(graph, 'auth');
    expect(result.qualifiedId).toBe('auth');
    expect(result.alias).toBeUndefined();
    expect(result.localId).toBe('auth');
  });
});

// =============================================
// MCP multi-repo integration
// =============================================

describe('MCP multi-repo integration', () => {
  let originalCwd: () => string;

  beforeEach(() => {
    originalCwd = process.cwd;
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  function createMultiRepoFixtures() {
    const alpha = createFixture([
      { id: 'auth', title: 'Auth System', status: 'not_started', body: '\n## Problem\nAuth needed\n\n## Approach\nJWT\n' },
      { id: 'api', title: 'API Layer', status: 'draft', depends_on: ['auth'], body: '\n## Problem\nNeed API\n' },
    ]);
    const beta = createFixture([
      { id: 'ui', title: 'UI Components', status: 'not_started', body: '\n## Problem\nNeed UI\n\n## Approach\nReact\n' },
      { id: 'dashboard', title: 'Dashboard', status: 'draft', depends_on: ['ui'], body: '\n## Problem\nNeed dash\n' },
    ]);
    return { alpha, beta };
  }

  function createMultiRepoServer() {
    const { alpha, beta } = createMultiRepoFixtures();
    const repos = [
      { alias: 'alpha', path: alpha.root },
      { alias: 'beta', path: beta.root },
    ];
    const server = createMcpServer({ repos });
    return { server, alpha, beta, repos };
  }

  // --- Backward compatibility ---

  it('single-repo mode works without repos option', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_status', {});
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    expect(output.total).toBe(1);
  });

  // --- trellis_status ---

  it('trellis_status returns plans from all repos', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_status', {});
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    expect(output.total).toBe(4);

    const allIds = [
      ...output.byStatus.ready,
      ...output.byStatus.blocked,
      ...output.byStatus.draft,
    ].map((p: any) => p.id);
    expect(allIds).toContain('alpha:auth');
    expect(allIds).toContain('alpha:api');
    expect(allIds).toContain('beta:ui');
    expect(allIds).toContain('beta:dashboard');
  });

  // --- trellis_ready ---

  it('trellis_ready shows ready plans across repos', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_ready', {});
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    const readyIds = output.plans.map((p: any) => p.id);
    expect(readyIds).toContain('alpha:auth');
    expect(readyIds).toContain('beta:ui');
    // Blocked ones should not appear
    expect(readyIds).not.toContain('alpha:api');
    expect(readyIds).not.toContain('beta:dashboard');
  });

  it('trellis_ready returns next recommendation in multi-repo mode', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_ready', {});
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    // next should be non-null — multi-repo plans are writable, not remote
    expect(output.next).not.toBeNull();
    // next should be one of the ready plans
    const readyIds = output.plans.map((p: any) => p.id);
    expect(readyIds).toContain(output.next);
  });

  // --- trellis_show ---

  it('trellis_show resolves qualified plan ID', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_show', { plan_id: 'alpha:auth' });
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    expect(output.id).toBe('alpha:auth');
    expect(output.title).toBe('Auth System');
  });

  it('trellis_show resolves unqualified ID when unambiguous', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_show', { plan_id: 'auth' });
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    expect(output.id).toBe('alpha:auth');
  });

  it('trellis_show returns error for unknown plan', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_show', { plan_id: 'nonexistent' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('trellis_show errors on ambiguous unqualified ID', async () => {
    // Create two repos with a plan named 'shared' in each
    const alpha = createFixture([
      { id: 'shared', title: 'Shared Alpha', status: 'draft', body: '\n## Problem\nAlpha\n' },
    ]);
    const beta = createFixture([
      { id: 'shared', title: 'Shared Beta', status: 'draft', body: '\n## Problem\nBeta\n' },
    ]);
    const server = createMcpServer({
      repos: [
        { alias: 'alpha', path: alpha.root },
        { alias: 'beta', path: beta.root },
      ],
    });

    const result = await callTool(server, 'trellis_show', { plan_id: 'shared' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Ambiguous');
    expect(result.content[0].text).toContain('alpha:shared');
    expect(result.content[0].text).toContain('beta:shared');
  });

  it('trellis_set errors on ambiguous unqualified ID', async () => {
    const alpha = createFixture([
      { id: 'shared', title: 'Shared Alpha', status: 'draft', body: '\n## Problem\nAlpha\n' },
    ]);
    const beta = createFixture([
      { id: 'shared', title: 'Shared Beta', status: 'draft', body: '\n## Problem\nBeta\n' },
    ]);
    const server = createMcpServer({
      repos: [
        { alias: 'alpha', path: alpha.root },
        { alias: 'beta', path: beta.root },
      ],
    });

    const result = await callTool(server, 'trellis_set', {
      plan_id: 'shared',
      field: 'description',
      value: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Ambiguous');
  });

  // --- trellis_create ---

  it('trellis_create creates plan in specified repo', async () => {
    const { server, alpha } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_create', {
      id: 'alpha:new-plan',
      title: 'New Plan',
    });
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    expect(output.id).toBe('alpha:new-plan');

    // Verify file was created in alpha's plans dir
    const planDir = join(alpha.plansDir, 'new-plan');
    expect(existsSync(join(planDir, 'README.md'))).toBe(true);
  });

  it('trellis_create rejects unqualified ID in multi-repo mode', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_create', {
      id: 'bare-plan',
      title: 'Bare Plan',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('qualified');
  });

  it('trellis_create rejects unknown alias', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_create', {
      id: 'unknown:new-plan',
      title: 'New Plan',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown repo alias');
  });

  it('trellis_create does not create files in wrong repo', async () => {
    const { server, beta } = createMultiRepoServer();
    await callTool(server, 'trellis_create', {
      id: 'alpha:isolated-plan',
      title: 'Isolated Plan',
    });

    // Should NOT exist in beta's plans dir
    expect(existsSync(join(beta.plansDir, 'isolated-plan'))).toBe(false);
  });

  // --- trellis_write_section ---

  it('trellis_write_section writes to correct repo', async () => {
    const { server, alpha } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_write_section', {
      plan_id: 'alpha:auth',
      file: 'readme',
      section: 'Problem',
      content: 'Updated problem statement',
    });
    expect(result.isError).toBeFalsy();

    // Verify the file was updated
    const readmeContent = readFileSync(join(alpha.plansDir, 'auth', 'README.md'), 'utf8');
    expect(readmeContent).toContain('Updated problem statement');
  });

  it('trellis_write_section resolves unqualified ID', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_write_section', {
      plan_id: 'auth',
      file: 'readme',
      section: 'Problem',
      content: 'Updated via unqualified ID',
    });
    expect(result.isError).toBeFalsy();
  });

  // --- trellis_write_sections ---

  it('trellis_write_sections writes multiple sections to correct repo', async () => {
    const { server, beta } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_write_sections', {
      plan_id: 'beta:ui',
      writes: [
        { file: 'readme', section: 'Problem', content: 'Updated problem' },
        { file: 'readme', section: 'Approach', content: 'Updated approach' },
      ],
    });
    expect(result.isError).toBeFalsy();

    const readmeContent = readFileSync(join(beta.plansDir, 'ui', 'README.md'), 'utf8');
    expect(readmeContent).toContain('Updated problem');
    expect(readmeContent).toContain('Updated approach');
  });

  // --- trellis_set ---

  it('trellis_set updates frontmatter in correct repo', async () => {
    const { server, alpha } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_set', {
      plan_id: 'alpha:auth',
      field: 'description',
      value: 'A description for auth',
    });
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    expect(output.id).toBe('alpha:auth');
    expect(output.value).toBe('A description for auth');
  });

  // --- trellis_update ---

  it('trellis_update transitions status in correct repo', async () => {
    const { server, alpha } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_update', {
      plan_id: 'alpha:auth',
      status: 'in_progress',
      force: true,
    });
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    expect(output.id).toBe('alpha:auth');
    expect(output.previous_status).toBe('not_started');
    expect(output.status).toBe('in_progress');
  });

  // --- trellis_read_section ---

  it('trellis_read_section reads from correct repo', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_read_section', {
      plan_id: 'beta:ui',
      file: 'readme',
      section: 'Problem',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Need UI');
  });

  // --- trellis_graph ---

  it('trellis_graph returns unified graph', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_graph', {});
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    const nodeIds = output.nodes.map((n: any) => n.id);
    expect(nodeIds).toContain('alpha:auth');
    expect(nodeIds).toContain('alpha:api');
    expect(nodeIds).toContain('beta:ui');
    expect(nodeIds).toContain('beta:dashboard');
  });

  // --- trellis_lint ---

  it('trellis_lint validates across repos', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_lint', {});
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    expect(output).toHaveProperty('ok');
    // Should see plans from both repos in the total
    expect(output.total).toBe(4);
  });

  it('trellis_lint detects missing cross-repo dependencies', async () => {
    const alpha = createFixture([
      { id: 'core', title: 'Core', status: 'draft', body: '\n## Problem\nCore\n' },
    ]);
    const beta = createFixture([
      { id: 'feature', title: 'Feature', status: 'draft', depends_on: ['alpha:nonexistent'], body: '\n## Problem\nFeature\n' },
    ]);
    const server = createMcpServer({
      repos: [
        { alias: 'alpha', path: alpha.root },
        { alias: 'beta', path: beta.root },
      ],
    });

    const result = await callTool(server, 'trellis_lint', {});
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    const missingDepErrors = output.errors.filter((e: any) => e.type === 'missing_dependency');
    expect(missingDepErrors.length).toBeGreaterThanOrEqual(1);
    expect(missingDepErrors[0].message).toContain('alpha:nonexistent');
  });

  // --- trellis_bottlenecks ---

  it('trellis_bottlenecks analyzes across repos', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_bottlenecks', {});
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    expect(output.healthSummary.totalPlans).toBe(4);
  });

  // --- Cross-repo dependencies ---

  it('handles cross-repo dependencies correctly', async () => {
    const alpha = createFixture([
      { id: 'core', title: 'Core', status: 'done', body: '\n## Problem\nCore needed\n\n## Approach\nBuild it\n' },
    ]);
    const beta = createFixture([
      { id: 'feature', title: 'Feature', status: 'not_started', depends_on: ['alpha:core'], body: '\n## Problem\nFeature needed\n\n## Approach\nBuild it\n' },
    ]);

    const server = createMcpServer({
      repos: [
        { alias: 'alpha', path: alpha.root },
        { alias: 'beta', path: beta.root },
      ],
    });

    const result = await callTool(server, 'trellis_ready', {});
    const output = JSON.parse(result.content[0].text);
    const readyIds = output.plans.map((p: any) => p.id);
    // beta:feature should be ready since alpha:core is done
    expect(readyIds).toContain('beta:feature');
  });
});

// =============================================
// Remote field behavior
// =============================================

describe('remote field', () => {
  it('plans from createMultiContext do NOT have remote=true', () => {
    const { root: root1 } = createFixture([
      { id: 'plan-a', title: 'Plan A', status: 'not_started' },
    ]);
    const ctx = createMultiContext([{ alias: 'repo1', path: root1 }]);

    const plan = ctx.plans[0];
    expect(plan.repoAlias).toBe('repo1');
    expect(plan.remote).toBeUndefined();
  });

  it('plans with repoAlias but no remote flag are writable', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);

    const server = createMcpServer({
      repos: [{ alias: 'myrepo', path: root }],
    });

    const result = await callTool(server, 'trellis_set', {
      plan_id: 'myrepo:test',
      field: 'description',
      value: 'updated',
    });
    expect(result.isError).toBeFalsy();
  });
});
