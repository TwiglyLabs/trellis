import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, relative, dirname, basename } from 'path';
import { parseFrontmatter } from './frontmatter.ts';
import { parseInputs, parseOutputs } from './contracts.ts';
import type { Plan, TrellisConfig } from './types.ts';

export function derivePlanId(filePath: string, plansDir: string): string {
  // Plans are always directories — filePath points to the README.md
  const rel = relative(plansDir, filePath);
  return dirname(rel).replace(/\\/g, '/');
}

export function scanPlans(plansDir: string): Plan[] {
  const plans: Plan[] = [];
  walkDir(plansDir, plansDir, plans);
  return plans;
}

function walkDir(dir: string, plansDir: string, plans: Plan[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Check if this directory is a plan (has README.md)
      const readmePath = join(fullPath, 'README.md');
      if (existsSync(readmePath)) {
        const content = readFileSync(readmePath, 'utf8');
        const result = parseFrontmatter(content);
        if (result) {
          const plan: Plan = {
            id: derivePlanId(readmePath, plansDir),
            filePath: readmePath,
            frontmatter: result.frontmatter,
            body: result.body,
            lineCount: content.split('\n').length,
          };

          // Load contracts
          const inputsPath = join(fullPath, 'inputs.md');
          const outputsPath = join(fullPath, 'outputs.md');
          if (existsSync(inputsPath)) {
            plan.inputs = parseInputs(readFileSync(inputsPath, 'utf8'));
          }
          if (existsSync(outputsPath)) {
            plan.outputs = parseOutputs(readFileSync(outputsPath, 'utf8'));
          }

          // Load implementation.md content for lineCount aggregation
          const implPath = join(fullPath, 'implementation.md');
          if (existsSync(implPath)) {
            const implContent = readFileSync(implPath, 'utf8');
            plan.lineCount += implContent.split('\n').length;
          }

          plans.push(plan);
        }
        // Don't recurse into plan directories — they are leaf nodes
      } else {
        // Not a plan directory — recurse to find plans deeper
        walkDir(fullPath, plansDir, plans);
      }
    }
    // Single .md files at any level are ignored — plans must be directories
  }
}

export function loadConfig(cwd: string): TrellisConfig {
  const configPath = join(cwd, '.trellis');

  if (existsSync(configPath)) {
    const content = readFileSync(configPath, 'utf8');
    const config: Partial<TrellisConfig> = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, rawValue] = match;
        const value = rawValue.replace(/\s*#.*$/, '').trim();
        if (key === 'project') config.project = value;
        if (key === 'plans_dir') config.plans_dir = value;
        if (key === 'chunk_max_lines') {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed) && parsed > 0) config.chunk_max_lines = parsed;
        }
        if (key === 'chunk_strategy' && (value === 'topological' || value === 'directory')) {
          config.chunk_strategy = value;
        }
      }
    }
    return {
      project: config.project || basename(cwd),
      plans_dir: config.plans_dir || 'plans',
      chunk_max_lines: config.chunk_max_lines,
      chunk_strategy: config.chunk_strategy,
    };
  }

  return {
    project: basename(cwd),
    plans_dir: 'plans',
  };
}
