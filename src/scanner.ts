import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, relative, dirname, basename } from 'path';
import { parseFrontmatter } from './frontmatter.ts';
import type { Plan, TrellisConfig } from './types.ts';

export function derivePlanId(filePath: string, plansDir: string): string {
  const rel = relative(plansDir, filePath);
  if (basename(filePath) === 'README.md') {
    return dirname(rel).replace(/\\/g, '/');
  }
  return rel.replace(/\.md$/, '').replace(/\\/g, '/');
}

export function scanPlans(plansDir: string): Plan[] {
  const plans: Plan[] = [];
  const readmeDirs = new Set<string>();

  walkDir(plansDir, plansDir, plans, readmeDirs);
  return plans;
}

function walkDir(dir: string, plansDir: string, plans: Plan[], readmeDirs: Set<string>): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  // First pass: find README.md files to mark their directories
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (!stat.isDirectory() && entry === 'README.md') {
      readmeDirs.add(dir);
    }
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      walkDir(fullPath, plansDir, plans, readmeDirs);
    } else if (entry.endsWith('.md')) {
      // Skip non-README .md files in directories that have a README.md
      if (entry !== 'README.md' && readmeDirs.has(dir)) {
        continue;
      }

      const content = readFileSync(fullPath, 'utf8');
      const result = parseFrontmatter(content);
      if (result) {
        plans.push({
          id: derivePlanId(fullPath, plansDir),
          filePath: fullPath,
          frontmatter: result.frontmatter,
          body: result.body,
          lineCount: content.split('\n').length,
        });
      }
    }
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
      }
    }
    return {
      project: config.project || basename(cwd),
      plans_dir: config.plans_dir || 'plans',
      chunk_max_lines: config.chunk_max_lines,
    };
  }

  return {
    project: basename(cwd),
    plans_dir: 'plans',
  };
}
