import { join, dirname } from 'path';
import { existsSync, renameSync } from 'fs';
import { validatePlanId, updatePlanFile } from '../../core/index.ts';
import type { GraphData } from '../../core/graph.ts';

export interface RenameResult {
  oldId: string;
  newId: string;
  referencesUpdated: string[];
}

export interface ComputeRenameOptions {
  oldId: string;
  newId: string;
  plansDir: string;
  graph: GraphData;
}

export interface ComputeRenameCallbacks {
  refresh: () => void;
}

export function computeRename(options: ComputeRenameOptions, callbacks: ComputeRenameCallbacks): RenameResult {
  const { oldId, newId, plansDir, graph } = options;

  validatePlanId(newId);

  const plan = graph.plans.get(oldId);
  if (!plan) throw new Error(`Plan "${oldId}" not found.`);
  if (plan.repoAlias != null) {
    throw new Error(`Cannot modify remote plan '${oldId}'. Write operations are local only.`);
  }

  const newDir = join(plansDir, newId);

  if (existsSync(newDir)) {
    throw new Error(`Plan "${newId}" already exists.`);
  }

  const oldDir = dirname(plan.filePath);
  renameSync(oldDir, newDir);

  // Update depends_on references in all other plans
  const referencesUpdated: string[] = [];
  for (const [id, p] of graph.plans) {
    if (id === oldId) continue;
    if (p.frontmatter.depends_on?.includes(oldId)) {
      const newDeps = p.frontmatter.depends_on.map(d => d === oldId ? newId : d);
      updatePlanFile(join(plansDir, id, 'README.md'), { depends_on: newDeps });
      referencesUpdated.push(id);
    }
  }

  callbacks.refresh();
  return { oldId, newId, referencesUpdated };
}
