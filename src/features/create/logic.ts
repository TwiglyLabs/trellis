import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import matter from 'gray-matter';
import type { GraphData } from '../../core/graph.ts';
import { validatePlanId } from '../../core/index.ts';
import type { CreateOptions } from '../../core/types.ts';
import { BUILT_IN_TEMPLATES, loadTemplate, stripHints, listTemplateTypes } from '../../templates.ts';

export interface CreateResult {
  id: string;
  filePath: string;
}

export interface ComputeCreateOptions {
  id: string;
  opts: CreateOptions;
  plansDir: string;
  graph: GraphData;
  projectDir?: string;
}

export function computeCreate(options: ComputeCreateOptions): CreateResult {
  const { id, opts, plansDir, graph, projectDir } = options;

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

  // Resolve template
  const type = opts.type;
  let templateFiles: Record<string, string> | null = null;

  if (type && projectDir) {
    templateFiles = loadTemplate(projectDir, type);
    if (!templateFiles) {
      const available = listTemplateTypes(projectDir);
      throw new Error(`Unknown template type "${type}". Available types: ${available.join(', ')}`);
    }
  } else if (type) {
    // No projectDir — use built-in templates only
    templateFiles = BUILT_IN_TEMPLATES[type] ?? null;
    if (!templateFiles) {
      throw new Error(`Unknown template type "${type}".`);
    }
  }

  mkdirSync(planDir, { recursive: true });

  const data: Record<string, any> = { title: opts.title, status: 'draft' };
  if (opts.description) data.description = opts.description;
  if (opts.depends_on?.length) data.depends_on = opts.depends_on;
  if (opts.tags?.length) data.tags = opts.tags;
  if (type) data.type = type;

  if (templateFiles) {
    // Use template for scaffolding
    const readmeTemplate = templateFiles['README.md'] ?? '';
    const body = '\n' + stripHints(readmeTemplate);
    const content = matter.stringify(body, data);
    const filePath = join(planDir, 'README.md');
    writeFileSync(filePath, content);

    // Write additional template files (implementation.md, etc.)
    for (const [filename, fileContent] of Object.entries(templateFiles)) {
      if (filename === 'README.md') continue;
      writeFileSync(join(planDir, filename), stripHints(fileContent));
    }

    return { id, filePath };
  }

  // Default scaffold (no type specified)
  const body = '\n## Problem\n\n\n## Approach\n\n';
  const content = matter.stringify(body, data);
  const filePath = join(planDir, 'README.md');
  writeFileSync(filePath, content);

  return { id, filePath };
}
