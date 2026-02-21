import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createContext, createFileLock } from './core/index.ts';
import type { PlanStatus } from './core/types.ts';
import { computeCreate } from './features/create/logic.ts';
import { computeWriteSection, computeWriteSections, computeReadSection } from './features/sections/logic.ts';
import { computeSet } from './features/set/logic.ts';
import { computeUpdate } from './features/update/logic.ts';
import { computeStatus } from './features/status/logic.ts';
import { computeReady } from './features/ready/logic.ts';
import { computeShow } from './features/show/logic.ts';
import { computeGraph } from './features/graph/logic.ts';
import { computeLint } from './features/lint/logic.ts';

const STATUS_VALUES = ['draft', 'not_started', 'in_progress', 'done', 'archived'] as const;

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'trellis',
    version: '0.1.0',
  });

  const withLock = createFileLock();

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
      const projectDir = process.cwd();
      const ctx = createContext(projectDir);
      const resolvedType = planType ?? ctx.config.default_plan_type;
      const result = computeCreate(
        { id, opts: { title, description, depends_on, tags, type: resolvedType }, plansDir: ctx.plansDir, graph: ctx.graph, projectDir },
        { refresh: () => {} },
      );
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ id: result.id, filePath: result.filePath }, null, 2),
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
        const ctx = createContext(process.cwd());
        const result = computeWriteSection(
          { planId: plan_id, file, section, content, graph: ctx.graph },
          { refresh: () => {} },
        );
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
        const ctx = createContext(process.cwd());
        const result = computeWriteSections(
          { planId: plan_id, writes, graph: ctx.graph },
          { refresh: () => {} },
        );
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
      const ctx = createContext(process.cwd());
      const result = computeReadSection({ planId: plan_id, file, section, graph: ctx.graph });
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
        const ctx = createContext(process.cwd());
        const result = computeSet(
          { planId: plan_id, field, value, mode: mode ?? 'replace', graph: ctx.graph },
          { refresh: () => {} },
        );
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
        const ctx = createContext(process.cwd());
        const result = computeUpdate(
          { planId: plan_id, status: status as PlanStatus, graph: ctx.graph, force },
          { refresh: () => {} },
        );
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
      const ctx = createContext(process.cwd());
      const result = computeStatus({
        plans: ctx.plans,
        config: ctx.config,
        graph: ctx.graph,
        filters: { tag, showDone: true, showArchived: true },
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
      const ctx = createContext(process.cwd());
      const result = computeReady({
        plans: ctx.plans,
        graph: ctx.graph,
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
      const ctx = createContext(process.cwd());
      const result = computeShow({ planId: plan_id, graph: ctx.graph });
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
      const ctx = createContext(process.cwd());
      const result = computeGraph({
        plans: ctx.plans,
        graph: ctx.graph,
        config: ctx.config,
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
      const ctx = createContext(process.cwd());
      const result = computeLint({
        plans: ctx.plans,
        graph: ctx.graph,
        projectDir: ctx.projectDir,
        plansDir: ctx.plansDir,
        manifest: ctx.manifest,
        projectName: ctx.config.project,
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

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
