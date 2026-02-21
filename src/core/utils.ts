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
 * Resolve which plans to display based on --project flag.
 * Without --project: local plans only. With --project: all plans from all repos.
 * If --project but no manifest: warn and fall back to local-only.
 */
export function resolveProjectPlans(
  plans: Plan[],
  manifest?: ProjectManifest,
  project?: boolean,
): { plans: Plan[]; isProject: boolean } {
  if (!project) return { plans: plans.filter(p => p.repoAlias == null), isProject: false };
  if (!manifest) {
    console.error('No manifest configured — showing local plans only');
    return { plans: plans.filter(p => p.repoAlias == null), isProject: false };
  }
  return { plans, isProject: true };
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
