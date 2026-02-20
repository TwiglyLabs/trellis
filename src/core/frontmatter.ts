import matter from 'gray-matter';
import { readFileSync, writeFileSync } from 'fs';
import type { PlanFrontmatter, ValidationError } from './types.ts';
import { VALID_STATUSES } from './utils.ts';

export function parseFrontmatter(content: string): { frontmatter: PlanFrontmatter; body: string } | null {
  let parsed;
  try {
    parsed = matter(content);
  } catch {
    return null;
  }
  if (!parsed.data || !parsed.data.title) {
    return null;
  }
  if (!parsed.data.status || !VALID_STATUSES.includes(parsed.data.status)) {
    return null;
  }
  return {
    frontmatter: parsed.data as PlanFrontmatter,
    body: parsed.content,
  };
}

export function validateFrontmatter(planId: string, frontmatter: PlanFrontmatter): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!frontmatter.title || typeof frontmatter.title !== 'string') {
    errors.push({ planId, field: 'title', message: 'title is required and must be a string' });
  }

  if (!frontmatter.status) {
    errors.push({ planId, field: 'status', message: 'status is required' });
  } else if (!VALID_STATUSES.includes(frontmatter.status as any)) {
    errors.push({
      planId,
      field: 'status',
      message: `invalid status "${frontmatter.status}". Must be one of: ${VALID_STATUSES.join(', ')}`,
    });
  }

  if (frontmatter.depends_on !== undefined && !Array.isArray(frontmatter.depends_on)) {
    errors.push({ planId, field: 'depends_on', message: 'depends_on must be an array' });
  }

  if (frontmatter.tags !== undefined && !Array.isArray(frontmatter.tags)) {
    errors.push({ planId, field: 'tags', message: 'tags must be an array' });
  }

  return errors;
}

export function readPlanFile(filePath: string): { frontmatter: PlanFrontmatter; body: string } | null {
  const content = readFileSync(filePath, 'utf8');
  return parseFrontmatter(content);
}

export function updatePlanFile(filePath: string, updates: Partial<PlanFrontmatter>, deleteFields?: string[]): void {
  const content = readFileSync(filePath, 'utf8');
  let parsed;
  try {
    parsed = matter(content);
  } catch {
    throw new Error(`Cannot update ${filePath}: file has invalid YAML frontmatter`);
  }

  const newData: Record<string, unknown> = { ...parsed.data, ...updates };

  if (deleteFields) {
    for (const field of deleteFields) {
      delete newData[field];
    }
  }

  const updated = matter.stringify(parsed.content, newData);
  writeFileSync(filePath, updated);
}
