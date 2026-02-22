import type { Plan, PlanStatus, ProjectManifest } from './types.ts';

export const VALID_STATUSES: readonly PlanStatus[] = ['draft', 'not_started', 'in_progress', 'done', 'archived'] as const;

export function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return `${count} ${singular}`;
  return `${count} ${plural ?? singular + 's'}`;
}

export function computeColumnWidth(items: string[], min = 20, max = 50): number {
  if (items.length === 0) return min;
  const longest = Math.max(...items.map(s => s.length));
  return Math.min(Math.max(longest + 2, min), max);
}

export function formatLines(lines: number): string {
  if (lines >= 1000) {
    return `${(lines / 1000).toFixed(1)}K`;
  }
  return String(lines);
}

/** Validate that a plan ID is a safe, single directory name. */
export function validatePlanId(id: string): void {
  if (!id || id.trim() !== id) {
    throw new Error(`Invalid plan ID "${id}". Must be a non-empty, trimmed string.`);
  }
  if (/[\/\\]/.test(id) || id === '.' || id === '..' || id.startsWith('.')) {
    throw new Error(`Invalid plan ID "${id}". Must be a simple directory name (no slashes, no leading dot).`);
  }
  if (/[<>:"|?*\x00-\x1f]/.test(id)) {
    throw new Error(`Invalid plan ID "${id}". Contains invalid characters.`);
  }
}

/**
 * Parse a qualified plan ID reference.
 * Format: `<repo-alias>:<plan-id>` for cross-repo, or just `<plan-id>` for local.
 * Splits on the first colon.
 */
export function parseQualifiedId(ref: string): { repo?: string; planId: string } {
  const colonIdx = ref.indexOf(':');
  if (colonIdx === -1) return { planId: ref };
  return { repo: ref.substring(0, colonIdx), planId: ref.substring(colonIdx + 1) };
}

/**
 * Determine whether to use project mode for display.
 * Auto-detects via ctx.isProjectMode; --project flag overrides.
 * Warns when --project is passed but no manifest is configured.
 */
export function resolveIsProject(ctx: { isProjectMode: boolean; manifest?: ProjectManifest }, projectFlag?: boolean): boolean {
  if (ctx.isProjectMode) return true;
  if (!projectFlag) return false;
  // --project flag explicitly passed but context is not in project mode
  if (!ctx.manifest) {
    console.error('No manifest configured — showing local plans only');
    return false;
  }
  return true;
}

/**
 * Build the `repos` array for --project --json output.
 * Groups items by repoAlias, counts them, sorts local first then alphabetical.
 */
export function buildReposArray(
  items: { repoAlias?: string }[],
  localProject: string,
): { alias: string; local: boolean; plan_count: number }[] {
  const repoCounts = new Map<string, number>();
  for (const item of items) {
    const key = item.repoAlias ?? localProject;
    repoCounts.set(key, (repoCounts.get(key) ?? 0) + 1);
  }
  return [...repoCounts.entries()]
    .sort((a, b) => {
      if (a[0] === localProject) return -1;
      if (b[0] === localProject) return 1;
      return a[0].localeCompare(b[0]);
    })
    .map(([alias, count]) => ({
      alias,
      local: alias === localProject,
      plan_count: count,
    }));
}

export interface ResolvedPlanId {
  qualifiedId: string;
  alias?: string;
  localId: string;
}

/**
 * Resolve a raw plan ID against a graph.
 * - Qualified IDs (alias:planId): verified to exist in graph.
 * - Unqualified IDs: searched across all qualified entries. Errors if ambiguous.
 */
export function resolvePlanId(graph: import('./graph.ts').GraphData, rawId: string): ResolvedPlanId {
  // Direct lookup first (works for both qualified and unqualified)
  if (graph.plans.has(rawId)) {
    const parsed = parseQualifiedId(rawId);
    return {
      qualifiedId: rawId,
      alias: parsed.repo,
      localId: parsed.planId,
    };
  }

  // If it was qualified but not found, that's an error
  const parsed = parseQualifiedId(rawId);
  if (parsed.repo) {
    throw new Error(`Plan "${rawId}" not found.`);
  }

  // Unqualified — search all qualified entries for a match
  const matches: string[] = [];
  for (const id of graph.plans.keys()) {
    const p = parseQualifiedId(id);
    if (p.planId === rawId) {
      matches.push(id);
    }
  }

  if (matches.length === 1) {
    const match = parseQualifiedId(matches[0]);
    return {
      qualifiedId: matches[0],
      alias: match.repo,
      localId: match.planId,
    };
  }

  if (matches.length === 0) {
    throw new Error(`Plan "${rawId}" not found.`);
  }

  // Ambiguous
  throw new Error(
    `Ambiguous plan ID "${rawId}" — matches: ${matches.join(', ')}. Use a qualified ID (alias:planId).`
  );
}

export function filterPlans(plans: Plan[], filters: { tag?: string; repo?: string }): Plan[] {
  let filtered = plans;
  if (filters.tag) {
    filtered = filtered.filter(p => p.frontmatter.tags?.includes(filters.tag!));
  }
  if (filters.repo) {
    filtered = filtered.filter(p => p.frontmatter.repo === filters.repo);
  }
  return filtered;
}
