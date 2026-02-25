/**
 * Text formatters for MCP read-only tool responses.
 *
 * Each formatter takes the compute result and returns a compact structured text string
 * optimized for LLM consumption. No compute functions or return types are modified.
 */

import type { StatusResult } from '../features/status/logic.ts';
import type { ReadyResult } from '../features/ready/logic.ts';
import type { ShowResult } from '../features/show/logic.ts';
import type { GraphResult } from '../features/graph/logic.ts';
import type { LintResult } from '../features/lint/logic.ts';
import type { PlanSummary, BlockedPlanSummary, BottleneckResult } from './types.ts';

// --- Internal helpers ---

function planLine(s: PlanSummary): string {
  let line = `- ${s.id}: ${s.title}`;
  if (s.assignee) line += ` [${s.assignee}]`;
  return line;
}

function blockedLine(s: BlockedPlanSummary): string {
  let line = `- ${s.id}: ${s.title}`;
  if (s.assignee) line += ` [${s.assignee}]`;
  line += ` (waiting on: ${s.waitingOn.join(', ')})`;
  return line;
}

function section(heading: string, lines: string[]): string {
  if (lines.length === 0) return '';
  return `\n## ${heading}\n${lines.join('\n')}\n`;
}

// --- Exported formatters ---

export function formatStatus(status: StatusResult, ready: ReadyResult, tag?: string): string {
  const parts: string[] = [];

  // Header
  let header = `# ${status.project} (${status.total} plans)`;
  if (tag) header += ` (tag: ${tag})`;
  parts.push(header);

  // Next recommendation
  if (ready.next) {
    parts.push(`Next: ${ready.next}`);
  }

  // Over budget warning
  if (status.chunks.overBudget > 0) {
    parts.push(`⚠ ${status.chunks.overBudget} chunks over budget`);
  }

  // Sections in order: In Progress, Ready, Blocked, Draft, Done
  const inProgressLines = status.byStatus.inProgress.map(planLine);
  parts.push(section(`In Progress (${inProgressLines.length})`, inProgressLines));

  const readyLines = status.byStatus.ready.map(planLine);
  parts.push(section(`Ready (${readyLines.length})`, readyLines));

  const blockedLines = status.byStatus.blocked.map(blockedLine);
  parts.push(section(`Blocked (${blockedLines.length})`, blockedLines));

  const draftLines = status.byStatus.draft.map(planLine);
  parts.push(section(`Draft (${draftLines.length})`, draftLines));

  // Done: IDs only, comma-separated
  if (status.byStatus.done.length > 0) {
    const doneIds = status.byStatus.done.map(p => p.id).join(', ');
    parts.push(`\n## Done (${status.byStatus.done.length})\n${doneIds}\n`);
  }

  // Archived: omitted entirely

  return parts.filter(p => p !== '').join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function formatShow(result: ShowResult): string {
  const parts: string[] = [];

  // Header
  parts.push(`# ${result.title} (${result.id})`);

  // Status with annotation
  let statusLine = `Status: ${result.status}`;
  if (result.ready) statusLine += ' (ready)';
  else if (result.blocked) statusLine += ' (blocked)';
  parts.push(statusLine);

  // Optional metadata, one per line
  if (result.type) parts.push(`Type: ${result.type}`);
  if (result.tags.length > 0) parts.push(`Tags: ${result.tags.join(', ')}`);
  if (result.assignee) parts.push(`Assignee: ${result.assignee}`);
  if (result.repo) parts.push(`Repo: ${result.repo}`);

  // Description
  if (result.description) {
    parts.push('');
    parts.push(result.description);
  }

  // Dependencies
  if (result.dependsOn.length > 0) {
    const depLines = result.dependsOn.map(d => {
      const marker = d.satisfied ? '✓' : '○';
      return `${marker} ${d.id} (${d.status})`;
    });
    parts.push('');
    parts.push('## Dependencies');
    parts.push(depLines.join('\n'));
  }

  // Blocks
  if (result.blocks.length > 0) {
    parts.push('');
    parts.push('## Blocks');
    parts.push(result.blocks.join(', '));
  }

  // Critical path (omit if single node)
  if (result.criticalPath.length > 1) {
    parts.push('');
    parts.push('## Critical Path');
    parts.push(result.criticalPath.join(' → '));
  }

  return parts.join('\n').trim();
}

export function formatGraph(result: GraphResult): string {
  const parts: string[] = [];

  // Header
  parts.push(`# ${result.project} dependency graph`);

  // Edges
  if (result.edges.length > 0) {
    const edgeLines = result.edges.map(e => `${e.from} → ${e.to}`);
    parts.push('');
    parts.push('## Edges');
    parts.push(edgeLines.join('\n'));
  }

  // Chunks
  if (result.chunks.length > 0) {
    parts.push('');
    parts.push('## Chunks');
    for (const chunk of result.chunks) {
      parts.push(`### ${chunk.id} (${chunk.planCount} plans, ${chunk.totalLines} lines)`);
      parts.push(`Plans: ${chunk.plans.map(p => p.id).join(', ')}`);
      parts.push(`Roots: ${chunk.roots.join(', ')} | Leaves: ${chunk.leaves.join(', ')}`);
    }
  }

  // Cross-chunk edges
  if (result.crossChunkEdges.length > 0) {
    parts.push('');
    parts.push('## Cross-chunk Edges');
    const crossLines = result.crossChunkEdges.map(
      e => `${e.from} (${e.fromChunk}) → ${e.to} (${e.toChunk})`
    );
    parts.push(crossLines.join('\n'));
  }

  return parts.join('\n').trim();
}

export function formatLint(result: LintResult): string {
  const parts: string[] = [];

  // Merge structural issues into main arrays
  const allErrors = [...result.errors, ...result.structural.errors];
  const allWarnings = [...result.warnings, ...result.structural.warnings];

  // Header
  parts.push(`# Lint (${allErrors.length} errors, ${allWarnings.length} warnings)`);

  // Errors
  if (allErrors.length > 0) {
    const errorLines = allErrors.map(e => `- ${e.planId}: ${e.message}`);
    parts.push('');
    parts.push('## Errors');
    parts.push(errorLines.join('\n'));
  }

  // Warnings
  if (allWarnings.length > 0) {
    const warnLines = allWarnings.map(w => `- ${w.planId}: ${w.message}`);
    parts.push('');
    parts.push('## Warnings');
    parts.push(warnLines.join('\n'));
  }

  // Auto-fixed
  if (result.fixed.length > 0) {
    parts.push('');
    parts.push('## Auto-fixed');
    parts.push(result.fixed.map(f => `- ${f}`).join('\n'));
  }

  // ok line
  parts.push('');
  parts.push(`ok: ${result.ok}`);

  return parts.join('\n').trim();
}

export function formatBottlenecks(result: BottleneckResult): string {
  const parts: string[] = [];

  parts.push('# Bottlenecks');

  // High Blocking
  if (result.highBlockingPlans.length > 0) {
    const lines = result.highBlockingPlans.map(
      p => `- ${p.id}: blocks ${p.blockingFactor} transitively (${p.status})`
    );
    parts.push('');
    parts.push('## High Blocking');
    parts.push(lines.join('\n'));
  }

  // Stuck
  if (result.stuckPlans.length > 0) {
    const lines = result.stuckPlans.map(
      p => `- ${p.id}: ${p.daysInStatus} days in status`
    );
    parts.push('');
    parts.push('## Stuck');
    parts.push(lines.join('\n'));
  }

  // Stale
  if (result.stalePlans.length > 0) {
    const lines = result.stalePlans.map(
      p => `- ${p.id}: ${p.daysInStatus} days in ${p.status}`
    );
    parts.push('');
    parts.push('## Stale');
    parts.push(lines.join('\n'));
  }

  // Health summary (always present)
  const hs = result.healthSummary;
  parts.push('');
  parts.push('## Health');
  parts.push(
    `${hs.totalPlans} total, ${hs.activePlans} active, ${hs.blockedPlans} blocked, ${hs.stuckPlans} stuck, parallelism: ${hs.estimatedParallelism}`
  );

  return parts.join('\n').trim();
}
