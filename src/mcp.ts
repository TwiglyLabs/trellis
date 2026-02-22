import { existsSync, readFileSync, mkdtempSync } from 'fs';
import { resolve, isAbsolute, join } from 'path';
import { tmpdir } from 'os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ContextStore, ensureCacheDir, loadConfig, createFileLock, resolvePlanId, parseQualifiedId, parseManifest } from './core/index.ts';
import type { PlanStatus, RepoSpec, MultiRepoEntry, TrellisConfig } from './core/types.ts';
import type { GraphData } from './core/graph.ts';
import { computeCreate } from './features/create/logic.ts';
import { computeWriteSection, computeWriteSections, computeReadSection } from './features/sections/logic.ts';
import { computeSet } from './features/set/logic.ts';
import { computeUpdate } from './features/update/logic.ts';
import { computeStatus } from './features/status/logic.ts';
import { computeReady } from './features/ready/logic.ts';
import { computeShow } from './features/show/logic.ts';
import { computeGraph } from './features/graph/logic.ts';
import { computeLint } from './features/lint/logic.ts';
import { computeBottlenecks } from './features/bottlenecks/logic.ts';

const STATUS_VALUES = ['draft', 'not_started', 'in_progress', 'done', 'archived'] as const;

/**
 * Parse --repos flag: "alias=path,alias=path" → RepoSpec[].
 */
export function parseReposFlag(input: string): RepoSpec[] {
  const specs: RepoSpec[] = [];
  const seen = new Set<string>();

  for (const pair of input.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      throw new Error(`Invalid repo spec "${trimmed}" — expected alias=path format.`);
    }

    const alias = trimmed.substring(0, eqIdx).trim();
    const rawPath = trimmed.substring(eqIdx + 1).trim();

    if (!alias) {
      throw new Error(`Empty alias in repo spec "${trimmed}".`);
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(alias)) {
      throw new Error(`Invalid alias "${alias}" — must start with a letter and contain only letters, digits, hyphens, underscores.`);
    }
    if (seen.has(alias)) {
      throw new Error(`Duplicate alias "${alias}".`);
    }
    seen.add(alias);

    const absPath = isAbsolute(rawPath) ? rawPath : resolve(rawPath);
    if (!existsSync(absPath)) {
      throw new Error(`Path does not exist for alias "${alias}": ${absPath}`);
    }

    specs.push({ alias, path: absPath });
  }

  if (specs.length === 0) {
    throw new Error('No repo specs provided.');
  }

  return specs;
}

/**
 * Load RepoSpec[] from a .trellis-project manifest, using entries that have a `path` field.
 */
export function loadProjectRepos(projectDir: string): RepoSpec[] {
  const absDir = isAbsolute(projectDir) ? projectDir : resolve(projectDir);
  const manifestPath = join(absDir, '.trellis-project');

  if (!existsSync(manifestPath)) {
    throw new Error(`No .trellis-project manifest found in ${absDir}`);
  }

  const content = readFileSync(manifestPath, 'utf8');
  const manifest = parseManifest(content);

  const specs: RepoSpec[] = [];
  for (const [alias, entry] of Object.entries(manifest.repos)) {
    if (!entry.path) continue;

    const absPath = isAbsolute(entry.path) ? entry.path : resolve(absDir, entry.path);
    if (!existsSync(absPath)) {
      throw new Error(`Path does not exist for repo "${alias}": ${absPath}`);
    }

    specs.push({ alias, path: absPath });
  }

  if (specs.length === 0) {
    throw new Error(`No repos with local "path" found in manifest at ${manifestPath}`);
  }

  return specs;
}

/** Internal context returned by getToolContext() */
interface ToolContext {
  plans: import('./core/types.ts').Plan[];
  graph: GraphData;
  isMultiRepo: boolean;
  repoEntries?: MultiRepoEntry[];
  getPlansDir(alias?: string): string;
  getConfig(alias?: string): TrellisConfig;
  projectDir?: string;
}

export interface McpServerOptions {
  repos?: RepoSpec[];
  /** Override cache directory (defaults to .trellis/cache/ for single-repo, tmpdir for multi-repo). */
  cacheDir?: string;
  /** Internal: pre-built store (used by startMcpServer to share store with watch lifecycle). */
  _storeBundle?: { store: ContextStore; isMultiRepo: boolean; singleRepoProjectDir?: string };
}

/**
 * Build a ContextStore and cacheDir from the given options.
 * Separated for testability — tests can create their own stores and pass them in.
 */
function buildStore(options?: McpServerOptions): { store: ContextStore; isMultiRepo: boolean; singleRepoProjectDir?: string } {
  const repos = options?.repos;

  if (repos && repos.length > 0) {
    // Multi-repo mode
    const cacheDir = options?.cacheDir ?? mkdtempSync(join(tmpdir(), 'trellis-mcp-'));
    const store = new ContextStore({ repos, cacheDir });
    return { store, isMultiRepo: true };
  }

  // Single-repo mode
  const projectDir = process.cwd();
  let cacheDir: string;
  let config: TrellisConfig;
  try {
    config = loadConfig(projectDir);
    cacheDir = options?.cacheDir ?? ensureCacheDir(projectDir);
  } catch {
    // No config or can't create cache — use tmpdir
    config = { project: 'default', plans_dir: 'plans' } as TrellisConfig;
    cacheDir = options?.cacheDir ?? mkdtempSync(join(tmpdir(), 'trellis-mcp-'));
  }

  const store = new ContextStore({
    repos: [{ path: projectDir, alias: config.project }],
    cacheDir,
    qualifyIds: false,
  });
  return { store, isMultiRepo: false, singleRepoProjectDir: projectDir };
}

export function createMcpServer(options?: McpServerOptions): McpServer {
  const server = new McpServer({
    name: 'trellis',
    version: '0.1.0',
  });

  const withLock = createFileLock();
  const { store, isMultiRepo, singleRepoProjectDir } = options?._storeBundle ?? buildStore(options);

  // Load initial context (synchronous — populates cache).
  // Skip if an injected store bundle was provided (already loaded by caller).
  if (!options?._storeBundle) {
    store.load();
  }

  /** Build a ToolContext from the cached store. */
  function getToolContext(): ToolContext {
    const multi = store.get();

    if (isMultiRepo) {
      return {
        plans: multi.plans,
        graph: multi.graph,
        isMultiRepo: true,
        repoEntries: multi.repos,
        getPlansDir(alias?: string): string {
          if (!alias) throw new Error('Alias required in multi-repo mode.');
          const entry = multi.repos.find(r => r.alias === alias);
          if (!entry) throw new Error(`Unknown repo alias "${alias}".`);
          if (!entry.plansDir) throw new Error(`Repo "${alias}" has no plans directory.`);
          return entry.plansDir;
        },
        getConfig(alias?: string): TrellisConfig {
          if (!alias) throw new Error('Alias required in multi-repo mode.');
          const entry = multi.repos.find(r => r.alias === alias);
          if (!entry) throw new Error(`Unknown repo alias "${alias}".`);
          if (!entry.config) throw new Error(`Repo "${alias}" has no config.`);
          return entry.config;
        },
      };
    }

    // Single-repo mode
    const entry = multi.repos[0];
    return {
      plans: multi.plans,
      graph: multi.graph,
      isMultiRepo: false,
      projectDir: singleRepoProjectDir,
      getPlansDir(): string {
        return entry?.plansDir ?? join(singleRepoProjectDir!, 'plans');
      },
      getConfig(): TrellisConfig {
        return entry?.config ?? { project: 'default', plans_dir: 'plans' } as TrellisConfig;
      },
    };
  }

  /**
   * Resolve a plan_id in the current context.
   * In multi-repo mode, uses resolvePlanId for qualified/unqualified resolution.
   * In single-repo mode, returns the ID as-is.
   */
  function resolveId(graph: GraphData, rawId: string, isMulti: boolean): { qualifiedId: string; alias?: string; localId: string } {
    if (isMulti) {
      return resolvePlanId(graph, rawId);
    }
    return { qualifiedId: rawId, localId: rawId };
  }

  /**
   * After a write mutation: invalidate the affected repo and persist the index.
   * In single-repo mode, invalidates the only repo.
   */
  function afterWrite(alias?: string): void {
    if (alias) {
      store.invalidate(alias);
    } else if (!isMultiRepo) {
      const entry = store.get().repos[0];
      if (entry) store.invalidate(entry.alias);
    }
    // Fire-and-forget persist — non-fatal if it fails
    store.persist().catch(() => {});
  }

  // --- trellis_create ---
  server.registerTool('trellis_create', {
    title: 'Create Plan',
    description: 'Scaffold a new plan directory with README.md containing frontmatter and section headings.',
    inputSchema: {
      id: z.string().describe('Plan ID (becomes directory name under plans/)'),
      title: z.string().describe('Plan title for frontmatter'),
      description: z.string().optional().describe('One-line description'),
      depends_on: z.array(z.string()).optional().describe('Plan IDs this depends on'),
      tags: z.array(z.string()).optional().describe('Freeform tags'),
      type: z.string().optional().describe('Template type (feature, bugfix, refactor, investigation)'),
    },
  }, async ({ id, title, description, depends_on, tags, type: planType }) => {
    try {
      const ctx = getToolContext();
      let plansDir: string;
      let projectDir: string | undefined;
      let localId: string;
      let writeAlias: string | undefined;

      if (ctx.isMultiRepo) {
        const parsed = parseQualifiedId(id);
        if (!parsed.repo) {
          throw new Error('In multi-repo mode, plan ID must be qualified (alias:planId).');
        }
        plansDir = ctx.getPlansDir(parsed.repo);
        projectDir = ctx.repoEntries?.find(r => r.alias === parsed.repo)?.path;
        localId = parsed.planId;
        writeAlias = parsed.repo;
      } else {
        plansDir = ctx.getPlansDir();
        projectDir = ctx.projectDir;
        localId = id;
      }

      const config = ctx.isMultiRepo
        ? ctx.getConfig(parseQualifiedId(id).repo)
        : ctx.getConfig();
      const resolvedType = planType ?? config.default_plan_type;
      const result = computeCreate(
        { id: localId, opts: { title, description, depends_on, tags, type: resolvedType }, plansDir, graph: ctx.graph, projectDir },
      );
      afterWrite(writeAlias);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ id: ctx.isMultiRepo ? id : result.id, filePath: result.filePath }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  // --- trellis_write_section ---
  server.registerTool('trellis_write_section', {
    title: 'Write Section',
    description: 'Write prose content into a specific section of a plan file. Replaces the section content between ## headings.',
    inputSchema: {
      plan_id: z.string().describe('Plan ID'),
      file: z.enum(['readme', 'implementation', 'inputs', 'outputs']).describe('Which plan file to write to'),
      section: z.string().describe('Section name (e.g. "Problem", "Approach", "Steps")'),
      content: z.string().describe('Markdown content to write into the section'),
    },
  }, async ({ plan_id, file, section, content }) => {
    return withLock(plan_id, () => {
      try {
        const ctx = getToolContext();
        const resolved = resolveId(ctx.graph, plan_id, ctx.isMultiRepo);
        const result = computeWriteSection(
          { planId: resolved.qualifiedId, file, section, content, graph: ctx.graph },
        );
        afterWrite(resolved.alias);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ id: result.id, file: result.file, section: result.section }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    });
  });

  // --- trellis_write_sections ---
  server.registerTool('trellis_write_sections', {
    title: 'Write Sections (Batch)',
    description: 'Write multiple sections to a plan in one atomic operation. Groups writes by file — each file gets a single read-modify-write. Preferred over multiple trellis_write_section calls.',
    inputSchema: {
      plan_id: z.string().describe('Plan ID'),
      writes: z.array(z.object({
        file: z.enum(['readme', 'implementation', 'inputs', 'outputs']).describe('Target file'),
        section: z.string().describe('Section name (## heading)'),
        content: z.string().describe('Markdown content for the section'),
      })).min(1).describe('Section writes to apply'),
    },
  }, async ({ plan_id, writes }) => {
    return withLock(plan_id, () => {
      try {
        const ctx = getToolContext();
        const resolved = resolveId(ctx.graph, plan_id, ctx.isMultiRepo);
        const result = computeWriteSections(
          { planId: resolved.qualifiedId, writes, graph: ctx.graph },
        );
        afterWrite(resolved.alias);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    });
  });

  // --- trellis_read_section ---
  server.registerTool('trellis_read_section', {
    title: 'Read Section',
    description: 'Read plan content at various granularities. Without file, returns all plan files. Without section, returns full file. With both, returns just that section.',
    inputSchema: {
      plan_id: z.string().describe('Plan ID'),
      file: z.enum(['readme', 'implementation', 'inputs', 'outputs']).optional().describe('Specific file to read. Omit for whole plan.'),
      section: z.string().optional().describe('Specific section. Requires file.'),
    },
  }, async ({ plan_id, file, section }) => {
    try {
      if (section && !file) {
        return {
          content: [{ type: 'text' as const, text: '--section requires --file' }],
          isError: true,
        };
      }
      const ctx = getToolContext();
      const resolved = resolveId(ctx.graph, plan_id, ctx.isMultiRepo);
      const result = computeReadSection({ planId: resolved.qualifiedId, file, section, graph: ctx.graph });
      return {
        content: [{ type: 'text' as const, text: result.content }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  // --- trellis_set ---
  server.registerTool('trellis_set', {
    title: 'Set Field',
    description: 'Update a frontmatter field. Cannot set "status" — use trellis_update for status transitions.',
    inputSchema: {
      plan_id: z.string().describe('Plan ID'),
      field: z.string().describe('Frontmatter field name (not "status")'),
      value: z.union([z.string(), z.array(z.string())]).describe('New value'),
      mode: z.enum(['replace', 'add', 'remove']).optional().describe('replace (default), add, or remove. add/remove only for list fields.'),
    },
  }, async ({ plan_id, field, value, mode }) => {
    return withLock(plan_id, () => {
      try {
        const ctx = getToolContext();
        const resolved = resolveId(ctx.graph, plan_id, ctx.isMultiRepo);
        const result = computeSet(
          { planId: resolved.qualifiedId, field, value, mode: mode ?? 'replace', graph: ctx.graph },
        );
        afterWrite(resolved.alias);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              id: result.id,
              field: result.field,
              value: result.value,
              previous_value: result.previousValue,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    });
  });

  // --- trellis_update ---
  server.registerTool('trellis_update', {
    title: 'Update Status',
    description: 'Transition a plan to a new status. Enforces status gates unless force is true.',
    inputSchema: {
      plan_id: z.string().describe('Plan ID'),
      status: z.enum(STATUS_VALUES).describe('Target status'),
      force: z.boolean().optional().describe('Bypass status gate validation'),
    },
  }, async ({ plan_id, status, force }) => {
    return withLock(plan_id, () => {
      try {
        const ctx = getToolContext();
        const resolved = resolveId(ctx.graph, plan_id, ctx.isMultiRepo);
        const result = computeUpdate(
          { planId: resolved.qualifiedId, status: status as PlanStatus, graph: ctx.graph, force },
        );
        afterWrite(resolved.alias);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              id: result.id,
              previous_status: result.previousStatus,
              status: result.newStatus,
              backward: result.backward,
              newly_ready: result.newlyReady,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    });
  });

  // --- trellis_status (read-only) ---
  server.registerTool('trellis_status', {
    title: 'Plan Status',
    description: 'Get a summary of all plans grouped by status: counts per status, and a flat list of plans with their key fields. Optional tag filter to scope to a single epic.',
    inputSchema: {
      tag: z.string().optional().describe('Filter plans by tag prefix (e.g. "epic:auth")'),
    },
  }, async ({ tag }) => {
    try {
      const ctx = getToolContext();
      const config = ctx.isMultiRepo
        ? (ctx.repoEntries?.[0]?.config ?? { project: 'multi-repo', plans_dir: 'plans' })
        : ctx.getConfig();
      const result = computeStatus({
        plans: ctx.plans,
        config,
        graph: ctx.graph,
        filters: { tag, showDone: true, showArchived: true, project: ctx.isMultiRepo },
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  // --- trellis_ready (read-only) ---
  server.registerTool('trellis_ready', {
    title: 'Ready Plans',
    description: 'Get plans that are ready to work on (not blocked, status is not_started). Includes the next recommendation — the highest-priority plan by forward path depth.',
    inputSchema: {},
  }, async () => {
    try {
      const ctx = getToolContext();
      const result = computeReady({
        plans: ctx.plans,
        graph: ctx.graph,
        filters: { project: ctx.isMultiRepo },
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  // --- trellis_show (read-only) ---
  server.registerTool('trellis_show', {
    title: 'Show Plan',
    description: 'Get full detail for a single plan: title, status, tags, assignee, dependencies, dependents, blocking status, and critical path position.',
    inputSchema: {
      plan_id: z.string().describe('Plan ID to show'),
    },
  }, async ({ plan_id }) => {
    try {
      const ctx = getToolContext();
      const resolved = resolveId(ctx.graph, plan_id, ctx.isMultiRepo);
      const result = computeShow({ planId: resolved.qualifiedId, graph: ctx.graph });
      if (!result) {
        return {
          content: [{ type: 'text' as const, text: `Plan "${plan_id}" not found` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  // --- trellis_graph (read-only) ---
  server.registerTool('trellis_graph', {
    title: 'Plan Graph',
    description: 'Get the full dependency graph as nodes and edges. Each node has id, title, status, tags; each edge is a { from, to } dependency pair.',
    inputSchema: {},
  }, async () => {
    try {
      const ctx = getToolContext();
      const config = ctx.isMultiRepo
        ? (ctx.repoEntries?.[0]?.config ?? { project: 'multi-repo', plans_dir: 'plans' })
        : ctx.getConfig();
      const result = computeGraph({
        plans: ctx.plans,
        graph: ctx.graph,
        config,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  // --- trellis_lint (read-only) ---
  server.registerTool('trellis_lint', {
    title: 'Lint Plans',
    description: 'Validate plans and return issues: cycles, missing deps, frontmatter errors, orphans, status gate violations. Returns issues array and summary counts.',
    inputSchema: {
      strict: z.boolean().optional().describe('When true, warnings also cause ok=false'),
    },
  }, async ({ strict }) => {
    try {
      const ctx = getToolContext();
      if (ctx.isMultiRepo) {
        const result = computeLint({
          plans: ctx.plans,
          graph: ctx.graph,
          projectDir: ctx.repoEntries?.[0]?.path ?? '',
          plansDir: ctx.repoEntries?.[0]?.plansDir ?? '',
          options: { strict },
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }

      // Single-repo: use cached context from store
      const entry = store.get().repos[0];
      const result = computeLint({
        plans: ctx.plans,
        graph: ctx.graph,
        projectDir: entry?.path ?? singleRepoProjectDir ?? '',
        plansDir: entry?.plansDir ?? join(singleRepoProjectDir ?? '', 'plans'),
        projectName: entry?.config?.project,
        options: { strict },
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  // --- trellis_bottlenecks (read-only) ---
  server.registerTool('trellis_bottlenecks', {
    title: 'Bottleneck Analysis',
    description: 'Analyze project bottlenecks: blocking factors, stuck plans, staleness, queue pressure, and health summary.',
    inputSchema: {},
  }, async () => {
    try {
      const ctx = getToolContext();
      const config = ctx.isMultiRepo
        ? (ctx.repoEntries?.[0]?.config ?? { project: 'multi-repo', plans_dir: 'plans' })
        : ctx.getConfig();
      const result = computeBottlenecks({
        plans: ctx.plans,
        graph: ctx.graph,
        config,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startMcpServer(options?: McpServerOptions): Promise<void> {
  const bundle = buildStore(options);
  bundle.store.load();

  // Start watching for filesystem changes (live invalidation)
  const watchHandle = bundle.store.watch();

  // Pass the pre-built store to createMcpServer so tool handlers share the same instance
  const server = createMcpServer({ ...options, _storeBundle: bundle });

  const transport = new StdioServerTransport();

  // Clean shutdown: close watchers and persist index
  async function shutdown(): Promise<void> {
    watchHandle.close();
    await bundle.store.persist();
  }

  process.on('SIGINT', () => { shutdown().finally(() => process.exit(0)); });
  process.on('SIGTERM', () => { shutdown().finally(() => process.exit(0)); });

  await server.connect(transport);
}
