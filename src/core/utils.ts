import type { Plan, PlanStatus } from './types.ts';

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
