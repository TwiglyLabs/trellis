import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import matter from 'gray-matter';
import type { GraphData } from '../../core/graph.ts';
import { validatePlanId } from '../../core/index.ts';
import type { CreateResult, CreateOptions } from '../../api.ts';

export interface ComputeCreateOptions {
  id: string;
  opts: CreateOptions;
  plansDir: string;
  graph: GraphData;
}

export interface ComputeCreateCallbacks {
  refresh: () => void;
}

export function computeCreate(options: ComputeCreateOptions, callbacks: ComputeCreateCallbacks): CreateResult {
  const { id, opts, plansDir, graph } = options;

  if (!opts.title) {
    throw new Error('title is required');
  }

  validatePlanId(id);

  const planDir = join(plansDir, id);

  if (existsSync(planDir)) {
    throw new Error(`Plan "${id}" already exists.`);
  }

  // Validate depends_on references
  if (opts.depends_on?.length) {
    for (const dep of opts.depends_on) {
      if (!graph.plans.has(dep)) {
        throw new Error(`Dependency "${dep}" not found.`);
      }
    }
  }

  mkdirSync(planDir, { recursive: true });

  const data: Record<string, any> = { title: opts.title, status: 'draft' };
  if (opts.description) data.description = opts.description;
  if (opts.depends_on?.length) data.depends_on = opts.depends_on;
  if (opts.tags?.length) data.tags = opts.tags;

  const body = '\n## Problem\n\n\n## Approach\n\n';
  const content = matter.stringify(body, data);
  const filePath = join(planDir, 'README.md');
  writeFileSync(filePath, content);

  callbacks.refresh();

  return { id, filePath };
}
