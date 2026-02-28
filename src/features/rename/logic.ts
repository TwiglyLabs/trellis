import { join, dirname } from 'path';
import { existsSync, renameSync, readFileSync } from 'fs';
import { validatePlanId, updatePlanFile, parseFrontmatter } from '../../core/index.ts';
import type { GraphData } from '../../core/graph.ts';

export interface RenameResult {
  oldId: string;
  newId: string;
  referencesUpdated: string[];
}

export interface MultiRepoRenameContext {
  localOldId: string;
  localNewId: string;
  repoAlias: string;
}

export interface ComputeRenameOptions {
  oldId: string;
  newId: string;
  plansDir: string;
  graph: GraphData;
  /** When provided, enables multi-repo rename with correct dep dequalification. */
  multiRepo?: MultiRepoRenameContext;
}

export interface ComputeRenameCallbacks {
  refresh: () => void;
}

export function computeRename(options: ComputeRenameOptions, callbacks: ComputeRenameCallbacks): RenameResult {
  const { oldId, newId, plansDir, graph, multiRepo } = options;

  const localNewId = multiRepo?.localNewId ?? newId;
  validatePlanId(localNewId);

  const plan = graph.plans.get(oldId);
  if (!plan) throw new Error(`Plan "${oldId}" not found.`);
  if (plan.remote) {
    throw new Error(`Cannot modify remote plan '${oldId}'. Write operations are local only.`);
  }

  const newDir = join(plansDir, localNewId);

  if (existsSync(newDir)) {
    throw new Error(`Plan "${localNewId}" already exists.`);
  }

  const oldDir = dirname(plan.filePath);
  renameSync(oldDir, newDir);

  // Update depends_on references in all other plans
  const referencesUpdated: string[] = [];
  for (const [id, p] of graph.plans) {
    if (id === oldId) continue;
    if (!p.frontmatter.depends_on?.includes(oldId)) continue;

    if (multiRepo) {
      // Multi-repo: read raw on-disk deps and replace both qualified and unqualified forms
      const rawContent = readFileSync(p.filePath, 'utf8');
      const rawParsed = parseFrontmatter(rawContent);
      if (!rawParsed) continue;

      const rawDeps = rawParsed.frontmatter.depends_on;
      if (!rawDeps) continue;

      const updatedDeps = rawDeps.map(d => {
        if (d === oldId) return newId; // qualified match (cross-repo reference)
        if (d === multiRepo.localOldId) return multiRepo.localNewId; // unqualified match (same-repo)
        return d;
      });

      updatePlanFile(p.filePath, { depends_on: updatedDeps });
      referencesUpdated.push(id);
    } else {
      // Single-repo: simple replacement
      const newDeps = p.frontmatter.depends_on.map(d => d === oldId ? newId : d);
      updatePlanFile(join(plansDir, id, 'README.md'), { depends_on: newDeps });
      referencesUpdated.push(id);
    }
  }

  callbacks.refresh();
  return { oldId, newId, referencesUpdated };
}
