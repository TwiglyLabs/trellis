import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createMcpServer, parseReposFlag, loadProjectRepos } from '../mcp.ts';
import { resolvePlanId, buildGraph, createMultiContext, dequalifyDepsForWrite } from '../core/index.ts';
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

    const { specs, warnings } = loadProjectRepos(projectDir);
    expect(specs).toHaveLength(2);
    expect(specs[0].alias).toBe('alpha');
    expect(specs[0].path).toBe(repo1);
    expect(specs[1].alias).toBe('beta');
    expect(specs[1].path).toBe(repo2);
    expect(warnings).toHaveLength(0);
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

    const { specs } = loadProjectRepos(projectDir);
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

  it('warns on missing repo paths instead of throwing', () => {
    const { root: repo1 } = createFixture([]);
    const { root: projectDir } = createFixture([]);

    const manifest = [
      'name: test-project',
      'repos:',
      '  good-repo:',
      `    path: ${repo1}`,
      '  bad-repo:',
      '    path: /nonexistent/path/to/repo',
    ].join('\n');

    const { writeFileSync: wfs } = require('fs');
    wfs(join(projectDir, '.trellis-project'), manifest);

    const { specs, warnings } = loadProjectRepos(projectDir);
    expect(specs).toHaveLength(1);
    expect(specs[0].alias).toBe('good-repo');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('bad-repo');
  });

  it('throws when all repo paths are missing', () => {
    const { root: projectDir } = createFixture([]);

    const manifest = [
      'name: test-project',
      'repos:',
      '  bad-repo:',
      '    path: /nonexistent/path/to/repo',
    ].join('\n');

    const { writeFileSync: wfs } = require('fs');
    wfs(join(projectDir, '.trellis-project'), manifest);

    expect(() => loadProjectRepos(projectDir)).toThrow('All repos in manifest have missing paths');
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

    const { specs } = loadProjectRepos(projectDir);
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
// dequalifyDepsForWrite
// =============================================

describe('dequalifyDepsForWrite', () => {
  it('strips same-repo qualification', () => {
    const result = dequalifyDepsForWrite(['infra-terraform:tf-gcp-foundation'], 'infra-terraform');
    expect(result).toEqual(['tf-gcp-foundation']);
  });

  it('preserves cross-repo qualification', () => {
    const result = dequalifyDepsForWrite(['acorn-cloud:cloud-api'], 'infra-terraform');
    expect(result).toEqual(['acorn-cloud:cloud-api']);
  });

  it('preserves already-unqualified deps', () => {
    const result = dequalifyDepsForWrite(['tf-gcp-foundation'], 'infra-terraform');
    expect(result).toEqual(['tf-gcp-foundation']);
  });

  it('handles mixed deps', () => {
    const result = dequalifyDepsForWrite(
      ['infra-terraform:tf-gcp-foundation', 'acorn-cloud:cloud-api', 'local-plan'],
      'infra-terraform',
    );
    expect(result).toEqual(['tf-gcp-foundation', 'acorn-cloud:cloud-api', 'local-plan']);
  });

  it('returns empty array for empty input', () => {
    expect(dequalifyDepsForWrite([], 'infra-terraform')).toEqual([]);
  });

  it('returns undefined for undefined input', () => {
    expect(dequalifyDepsForWrite(undefined, 'infra-terraform')).toBeUndefined();
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

    const text = result.content[0].text;
    expect(text).toContain('(1 plan');
  });

  it('single-repo mode rejects qualified ID with manifest guidance', async () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_create', {
      id: 'some-repo:new-plan',
      title: 'New Plan',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('project_root');
    expect(result.content[0].text).toContain('.trellis-project');
  });

  // --- trellis_status ---

  it('trellis_status returns plans from all repos', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_status', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toContain('(4 plans)');
    expect(text).toContain('alpha:auth');
    expect(text).toContain('alpha:api');
    expect(text).toContain('beta:ui');
    expect(text).toContain('beta:dashboard');
  });

  // --- trellis_ready ---

  it('trellis_status shows ready plans across repos', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_status', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    // Ready plans should appear
    expect(text).toContain('alpha:auth');
    expect(text).toContain('beta:ui');
    // Blocked/draft ones should also appear (in their own sections)
    expect(text).toContain('alpha:api');
    expect(text).toContain('beta:dashboard');
  });

  it('trellis_status returns next recommendation in multi-repo mode', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_status', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    // next should appear — multi-repo plans are writable, not remote
    expect(text).toMatch(/Next:/);
  });

  // --- trellis_show ---

  it('trellis_show resolves qualified plan ID', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_show', { plan_id: 'alpha:auth' });
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toContain('# Auth System (alpha:auth)');
  });

  it('trellis_show resolves unqualified ID when unambiguous', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_show', { plan_id: 'auth' });
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toContain('alpha:auth');
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

  it('trellis_create dequalifies same-repo deps on disk', async () => {
    const { server, alpha } = createMultiRepoServer();
    // alpha:auth already exists in the fixture
    const result = await callTool(server, 'trellis_create', {
      id: 'alpha:new-plan',
      title: 'New Plan',
      depends_on: ['alpha:auth', 'beta:ui'],
    });
    expect(result.isError).toBeFalsy();

    // Read the on-disk frontmatter
    const readme = readFileSync(join(alpha.plansDir, 'new-plan', 'README.md'), 'utf8');
    // Same-repo dep (alpha:auth) should be stored as 'auth' (dequalified)
    // Cross-repo dep (beta:ui) should be preserved (YAML quotes colons)
    expect(readme).toContain('- auth');
    expect(readme).toMatch(/beta:ui/);
    expect(readme).not.toMatch(/alpha:auth/);
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

  it('trellis_create rejects unknown alias with manifest guidance', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_create', {
      id: 'unknown:new-plan',
      title: 'New Plan',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found in manifest');
    expect(result.content[0].text).toContain('.trellis-project');
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

  // --- trellis_create_batch ---

  it('trellis_create_batch creates plans across repos', async () => {
    const { server, alpha, beta } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_create_batch', {
      plans: [
        { id: 'alpha:new-a', title: 'New A' },
        { id: 'beta:new-b', title: 'New B', depends_on: ['alpha:new-a'] },
      ],
    });
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    expect(output.created).toHaveLength(2);
    expect(output.created[0].id).toBe('alpha:new-a');
    expect(output.created[1].id).toBe('beta:new-b');

    expect(existsSync(join(alpha.plansDir, 'new-a', 'README.md'))).toBe(true);
    expect(existsSync(join(beta.plansDir, 'new-b', 'README.md'))).toBe(true);
  });

  it('trellis_create_batch skips existing plans', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_create_batch', {
      plans: [
        { id: 'alpha:auth', title: 'Auth' },  // already exists
        { id: 'alpha:brand-new', title: 'Brand New' },
      ],
    });
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    expect(output.created).toHaveLength(1);
    expect(output.created[0].id).toBe('alpha:brand-new');
    expect(output.skipped).toHaveLength(1);
    expect(output.skipped[0].id).toBe('alpha:auth');
  });

  it('trellis_create_batch dry-run validates without writing', async () => {
    const { server, alpha } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_create_batch', {
      plans: [
        { id: 'alpha:dry-plan', title: 'Dry Plan' },
      ],
      dry_run: true,
    });
    expect(result.isError).toBeFalsy();

    const output = JSON.parse(result.content[0].text);
    expect(output.wouldCreate).toHaveLength(1);
    expect(output.created).toHaveLength(0);
    expect(existsSync(join(alpha.plansDir, 'dry-plan'))).toBe(false);
  });

  it('trellis_create_batch returns error for invalid deps', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_create_batch', {
      plans: [
        { id: 'alpha:plan', title: 'Plan', depends_on: ['alpha:missing'] },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('trellis_create_batch dequalifies same-repo deps on disk', async () => {
    const { server, alpha } = createMultiRepoServer();
    await callTool(server, 'trellis_create_batch', {
      plans: [
        { id: 'alpha:base', title: 'Base' },
        { id: 'alpha:derived', title: 'Derived', depends_on: ['alpha:base', 'beta:ui'] },
      ],
    });

    const readme = readFileSync(join(alpha.plansDir, 'derived', 'README.md'), 'utf8');
    expect(readme).toContain('- base');
    expect(readme).not.toMatch(/alpha:base/);
    expect(readme).toMatch(/beta:ui/);
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

    const text = result.content[0].text;
    expect(text).toContain('## Edges');
    expect(text).toContain('alpha:auth');
    expect(text).toContain('alpha:api');
    expect(text).toContain('beta:ui');
    expect(text).toContain('beta:dashboard');
  });

  // --- trellis_lint ---

  it('trellis_lint validates across repos', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_lint', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toMatch(/ok: (true|false)/);
    // Should see plans from both repos referenced
    expect(text).toContain('# Lint');
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

    const text = result.content[0].text;
    expect(text).toContain('## Errors');
    expect(text).toContain('alpha:nonexistent');
  });

  // --- trellis_bottlenecks ---

  it('trellis_bottlenecks analyzes across repos', async () => {
    const { server } = createMultiRepoServer();
    const result = await callTool(server, 'trellis_bottlenecks', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toContain('## Health');
    expect(text).toContain('4 total');
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

    const result = await callTool(server, 'trellis_status', {});
    const text = result.content[0].text;
    // beta:feature should be ready since alpha:core is done
    expect(text).toContain('beta:feature');
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

// =============================================
// MCP project mode auto-detection
// =============================================

describe('MCP project mode auto-detection', () => {
  let originalCwd: () => string;

  beforeEach(() => {
    originalCwd = process.cwd;
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  function writeManifest(projectDir: string, repos: Record<string, string>): void {
    const { writeFileSync: wfs } = require('fs');
    const lines = ['name: test-project', 'repos:'];
    for (const [alias, path] of Object.entries(repos)) {
      lines.push(`  ${alias}:`, `    path: ${path}`);
    }
    wfs(join(projectDir, '.trellis-project'), lines.join('\n'));
  }

  function writeConfig(projectDir: string, manifest: string): void {
    const { writeFileSync: wfs, mkdirSync: mds, existsSync: es } = require('fs');
    const trellisDir = join(projectDir, '.trellis');
    if (!es(trellisDir)) mds(trellisDir, { recursive: true });
    wfs(join(trellisDir, 'config'), `project: test-project\nplans_dir: plans\nmanifest: ${manifest}\n`);
  }

  it('auto-detects project mode when manifest + .trellis-project exist', async () => {
    const alpha = createFixture([
      { id: 'auth', title: 'Auth', status: 'not_started', body: '\n## Problem\nAuth needed\n\n## Approach\nJWT\n' },
    ]);
    const beta = createFixture([
      { id: 'ui', title: 'UI', status: 'not_started', body: '\n## Problem\nUI needed\n\n## Approach\nReact\n' },
    ]);

    // Set up alpha as the "project root" with manifest pointing to both repos
    writeConfig(alpha.root, 'https://example.com/manifest.git');
    writeManifest(alpha.root, { alpha: alpha.root, beta: beta.root });
    process.cwd = () => alpha.root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_status', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toContain('(2 plans)');
    // Plans should be qualified with repo aliases
    expect(text).toContain('alpha:auth');
    expect(text).toContain('beta:ui');
  });

  it('falls back to single-repo when no manifest configured', async () => {
    const { root } = createFixture([
      { id: 'test', title: 'Test', status: 'draft', body: '\n## Problem\nText\n' },
    ]);
    process.cwd = () => root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_status', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toContain('(1 plan');
  });

  it('throws when manifest configured but no .trellis-project', () => {
    const { root } = createFixture([]);
    writeConfig(root, 'https://example.com/manifest.git');
    process.cwd = () => root;

    expect(() => createMcpServer()).toThrow('trellis sync');
  });

  it('cross-repo deps work in project mode', async () => {
    const alpha = createFixture([
      { id: 'core', title: 'Core', status: 'done', body: '\n## Problem\nCore\n\n## Approach\nBuild\n' },
    ]);
    const beta = createFixture([
      { id: 'feature', title: 'Feature', status: 'not_started', depends_on: ['alpha:core'], body: '\n## Problem\nFeature\n\n## Approach\nBuild\n' },
    ]);

    writeConfig(alpha.root, 'https://example.com/manifest.git');
    writeManifest(alpha.root, { alpha: alpha.root, beta: beta.root });
    process.cwd = () => alpha.root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_status', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toContain('beta:feature');
  });

  it('warns but continues when some repos are missing', async () => {
    const alpha = createFixture([
      { id: 'auth', title: 'Auth', status: 'not_started', body: '\n## Problem\nAuth\n\n## Approach\nJWT\n' },
    ]);

    writeConfig(alpha.root, 'https://example.com/manifest.git');
    writeManifest(alpha.root, { alpha: alpha.root, missing: '/nonexistent/repo' });
    process.cwd = () => alpha.root;

    // Should not throw — missing repos produce warnings, not failures
    const server = createMcpServer();
    const result = await callTool(server, 'trellis_status', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toContain('(1 plan');
  });

  it('explicit --repos overrides project mode', async () => {
    const alpha = createFixture([
      { id: 'auth', title: 'Auth', status: 'not_started', body: '\n## Problem\nAuth\n\n## Approach\nJWT\n' },
    ]);
    const beta = createFixture([
      { id: 'ui', title: 'UI', status: 'not_started', body: '\n## Problem\nUI\n\n## Approach\nReact\n' },
    ]);

    // Set up manifest pointing to alpha + beta
    writeConfig(alpha.root, 'https://example.com/manifest.git');
    writeManifest(alpha.root, { alpha: alpha.root, beta: beta.root });
    process.cwd = () => alpha.root;

    // But pass explicit --repos pointing only to beta
    const server = createMcpServer({
      repos: [{ alias: 'beta', path: beta.root }],
    });
    const result = await callTool(server, 'trellis_status', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    // Only beta plans, not alpha — explicit repos override project mode
    expect(text).toContain('(1 plan');
    expect(text).toContain('beta:ui');
    expect(text).not.toContain('alpha:auth');
  });
});

// =============================================
// --project flag (cli.ts integration)
// =============================================

describe('loadProjectRepos for --project flag', () => {
  it('returns specs and empty warnings for valid repos', () => {
    const { root: repo1 } = createFixture([
      { id: 'plan-a', title: 'Plan A', status: 'draft', body: '\n## Problem\nA\n' },
    ]);
    const { root: repo2 } = createFixture([
      { id: 'plan-b', title: 'Plan B', status: 'draft', body: '\n## Problem\nB\n' },
    ]);
    const { root: projectDir } = createFixture([]);

    writeFileSync(
      join(projectDir, '.trellis-project'),
      ['name: test-project', 'repos:', `  alpha:`, `    path: ${repo1}`, `  beta:`, `    path: ${repo2}`].join('\n'),
    );

    const { specs, warnings } = loadProjectRepos(projectDir);
    expect(specs).toHaveLength(2);
    expect(specs[0].alias).toBe('alpha');
    expect(specs[1].alias).toBe('beta');
    expect(warnings).toHaveLength(0);
  });

  it('returns warnings for missing repos without throwing', () => {
    const { root: repo1 } = createFixture([]);
    const { root: projectDir } = createFixture([]);

    writeFileSync(
      join(projectDir, '.trellis-project'),
      ['name: test-project', 'repos:', `  good:`, `    path: ${repo1}`, `  missing:`, `    path: /nonexistent/repo`].join('\n'),
    );

    const { specs, warnings } = loadProjectRepos(projectDir);
    expect(specs).toHaveLength(1);
    expect(specs[0].alias).toBe('good');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('missing');
    expect(warnings[0]).toContain('/nonexistent/repo');
  });

  it('specs from loadProjectRepos work with createMcpServer', () => {
    const { root: repo1 } = createFixture([
      { id: 'plan-a', title: 'Plan A', status: 'not_started', body: '\n## Problem\nA\n\n## Approach\nBuild\n' },
    ]);
    const { root: projectDir } = createFixture([]);

    writeFileSync(
      join(projectDir, '.trellis-project'),
      ['name: test-project', 'repos:', `  alpha:`, `    path: ${repo1}`].join('\n'),
    );

    const { specs } = loadProjectRepos(projectDir);
    // This is what cli.ts does after destructuring
    const server = createMcpServer({ repos: specs });
    expect(server).toBeDefined();
  });
});

// =============================================
// MCP project_root config field
// =============================================

describe('MCP project_root config field', () => {
  let originalCwd: () => string;

  beforeEach(() => {
    originalCwd = process.cwd;
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it('enters project mode from leaf repo via project_root', async () => {
    const alpha = createFixture([
      { id: 'auth', title: 'Auth', status: 'not_started', body: '\n## Problem\nAuth\n\n## Approach\nJWT\n' },
    ]);
    const beta = createFixture([
      { id: 'ui', title: 'UI', status: 'not_started', body: '\n## Problem\nUI\n\n## Approach\nReact\n' },
    ]);

    // Create meta-repo with .trellis-project
    const { mkdtempSync: mkdt } = require('fs');
    const { tmpdir: td } = require('os');
    const metaRoot = mkdt(require('path').join(td(), 'trellis-meta-'));
    writeFileSync(
      require('path').join(metaRoot, '.trellis-project'),
      ['name: test-project', 'repos:', `  alpha:`, `    path: ${alpha.root}`, `  beta:`, `    path: ${beta.root}`].join('\n'),
    );

    // Configure alpha as leaf with project_root
    writeFileSync(
      join(alpha.root, '.trellis', 'config'),
      `project: alpha\nplans_dir: plans\nproject_root: ${metaRoot}\n`,
    );
    process.cwd = () => alpha.root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_status', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toContain('(2 plans)');
    expect(text).toContain('alpha:auth');
    expect(text).toContain('beta:ui');
  });

  it('throws when project_root set but .trellis-project not found', () => {
    const { root } = createFixture([]);
    const { mkdtempSync: mkdt } = require('fs');
    const { tmpdir: td } = require('os');
    const emptyDir = mkdt(require('path').join(td(), 'trellis-empty-'));

    writeFileSync(
      join(root, '.trellis', 'config'),
      `project: test\nplans_dir: plans\nproject_root: ${emptyDir}\n`,
    );
    process.cwd = () => root;

    expect(() => createMcpServer()).toThrow('project_root');
  });

  it('cross-repo writes work via project_root', async () => {
    const alpha = createFixture([
      { id: 'auth', title: 'Auth', status: 'draft', body: '\n## Problem\nAuth\n' },
    ]);
    const beta = createFixture([
      { id: 'ui', title: 'UI', status: 'draft', body: '\n## Problem\nUI\n' },
    ]);

    const { mkdtempSync: mkdt } = require('fs');
    const { tmpdir: td } = require('os');
    const metaRoot = mkdt(require('path').join(td(), 'trellis-meta-'));
    writeFileSync(
      require('path').join(metaRoot, '.trellis-project'),
      ['name: test-project', 'repos:', `  alpha:`, `    path: ${alpha.root}`, `  beta:`, `    path: ${beta.root}`].join('\n'),
    );

    writeFileSync(
      join(alpha.root, '.trellis', 'config'),
      `project: alpha\nplans_dir: plans\nproject_root: ${metaRoot}\n`,
    );
    process.cwd = () => alpha.root;

    const server = createMcpServer();

    // Write to beta's plan from alpha's context
    const result = await callTool(server, 'trellis_set', {
      plan_id: 'beta:ui',
      field: 'description',
      value: 'Updated from alpha',
    });
    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text);
    expect(output.value).toBe('Updated from alpha');
  });
});

// =============================================
// Lint structural checks across repos
// =============================================

describe('MCP lint structural checks in multi-repo', () => {
  let originalCwd: () => string;

  beforeEach(() => {
    originalCwd = process.cwd;
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it('detects structural issues in non-first repos', async () => {
    // alpha has valid plans
    const alpha = createFixture([
      { id: 'core', title: 'Core', status: 'draft', body: '\n## Problem\nCore\n' },
    ]);
    // beta has valid plans too
    const beta = createFixture([
      { id: 'ui', title: 'UI', status: 'draft', body: '\n## Problem\nUI\n' },
    ]);

    // Add a malformed entry (directory without README.md) in beta's plans dir
    mkdirSync(join(beta.plansDir, 'broken-plan'), { recursive: true });
    // Add just a random file, no README.md
    writeFileSync(join(beta.plansDir, 'broken-plan', 'notes.txt'), 'not a plan');

    const server = createMcpServer({
      repos: [
        { alias: 'alpha', path: alpha.root },
        { alias: 'beta', path: beta.root },
      ],
    });

    const result = await callTool(server, 'trellis_lint', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toContain('## Errors');
    expect(text).toContain('broken-plan');
  });

  it('detects single-file plans in non-first repos', async () => {
    const alpha = createFixture([
      { id: 'core', title: 'Core', status: 'draft', body: '\n## Problem\nCore\n' },
    ]);
    const beta = createFixture([
      { id: 'ui', title: 'UI', status: 'draft', body: '\n## Problem\nUI\n' },
    ]);

    // Add a single-file plan in beta (a .md file directly in plans dir)
    writeFileSync(join(beta.plansDir, 'bad-plan.md'), '---\ntitle: Bad\nstatus: draft\n---\n');

    const server = createMcpServer({
      repos: [
        { alias: 'alpha', path: alpha.root },
        { alias: 'beta', path: beta.root },
      ],
    });

    const result = await callTool(server, 'trellis_lint', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toContain('## Errors');
    expect(text).toContain('bad-plan.md');
  });

  it('detects visibility violations in project mode with manifest', async () => {
    const alpha = createFixture([
      { id: 'secret', title: 'Secret', status: 'not_started', body: '\n## Problem\nSecret stuff\n\n## Approach\nPrivate\n' },
    ]);
    const beta = createFixture([
      { id: 'public-thing', title: 'Public', status: 'not_started', depends_on: ['alpha:secret'], body: '\n## Problem\nPublic\n\n## Approach\nBuild\n' },
    ]);

    // Set up project mode with visibility metadata
    writeFileSync(
      join(alpha.root, '.trellis', 'config'),
      `project: alpha\nplans_dir: plans\nmanifest: https://example.com/manifest.git\n`,
    );
    const manifest = [
      'name: test-project',
      'repos:',
      '  alpha:',
      `    path: ${alpha.root}`,
      '    url: https://github.com/org/alpha.git',
      '    branch: main',
      '    visibility: private',
      '  beta:',
      `    path: ${beta.root}`,
      '    url: https://github.com/org/beta.git',
      '    branch: main',
      '    visibility: public',
    ].join('\n');
    writeFileSync(join(alpha.root, '.trellis-project'), manifest);
    process.cwd = () => alpha.root;

    const server = createMcpServer();
    const result = await callTool(server, 'trellis_lint', {});
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toContain('## Errors');
    expect(text).toContain('public');
    expect(text).toContain('private');
  });
});
