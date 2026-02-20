import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createContext } from './core/index.ts';
import type { PlanStatus } from './core/types.ts';
import { computeCreate } from './features/create/logic.ts';
import { computeWriteSection, computeReadSection } from './features/sections/logic.ts';
import { computeSet } from './features/set/logic.ts';
import { computeUpdate } from './features/update/logic.ts';

const STATUS_VALUES = ['draft', 'not_started', 'in_progress', 'done', 'archived'] as const;

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'trellis',
    version: '0.1.0',
  });

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
    },
  }, async ({ id, title, description, depends_on, tags }) => {
    try {
      const ctx = createContext(process.cwd());
      const result = computeCreate(
        { id, opts: { title, description, depends_on, tags }, plansDir: ctx.plansDir, graph: ctx.graph },
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

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
