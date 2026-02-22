import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { readdir, stat, readFile, access } from 'fs/promises';
import { join, relative, dirname, basename } from 'path';
import { createHash } from 'crypto';
import { parseFrontmatter } from './frontmatter.ts';
import { parseInputs, parseOutputs } from './contracts.ts';
import type { Plan, TrellisConfig } from './types.ts';

const PLAN_FILES = ['README.md', 'implementation.md', 'inputs.md', 'outputs.md'] as const;

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
          // Compute recency metadata: max mtime and content hashes
          const fileHashes: Record<string, string> = {};
          let maxMtime = statSync(readmePath).mtime;
          fileHashes['README.md'] = createHash('sha256').update(content).digest('hex').slice(0, 16);

          for (const fileName of PLAN_FILES) {
            if (fileName === 'README.md') continue;
            const filePath = join(fullPath, fileName);
            if (existsSync(filePath)) {
              const fileStat = statSync(filePath);
              if (fileStat.mtime > maxMtime) maxMtime = fileStat.mtime;
              const fileContent = readFileSync(filePath, 'utf8');
              fileHashes[fileName] = createHash('sha256').update(fileContent).digest('hex').slice(0, 16);
            }
          }

          const plan: Plan = {
            id: derivePlanId(readmePath, plansDir),
            filePath: readmePath,
            frontmatter: result.frontmatter,
            body: result.body,
            lineCount: content.split('\n').length,
            updatedAt: maxMtime,
            fileHashes,
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

          // Load implementation.md content for lineCount aggregation and completeness scoring
          const implPath = join(fullPath, 'implementation.md');
          if (existsSync(implPath)) {
            const implContent = readFileSync(implPath, 'utf8');
            plan.lineCount += implContent.split('\n').length;
            plan.implementationContent = implContent;
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

/** Parse key=value config content into a TrellisConfig. */
export function parseConfigContent(content: string, cwd: string): TrellisConfig {
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
      if (key === 'manifest') config.manifest = value;
      if (key === 'project_root') config.project_root = value;
      if (key === 'default_plan_type') config.default_plan_type = value;
      if (key === 'stale_in_progress_days') {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed) && parsed > 0) config.stale_in_progress_days = parsed;
      }
      if (key === 'stale_not_started_days') {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed) && parsed > 0) config.stale_not_started_days = parsed;
      }
      if (key.startsWith('completeness_') && (key.endsWith('_low') || key.endsWith('_high'))) {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed) && parsed > 0) {
          if (!config.completenessThresholds) config.completenessThresholds = {};
          config.completenessThresholds[key] = parsed;
        }
      }
    }
  }
  return {
    project: config.project || basename(cwd),
    plans_dir: config.plans_dir || 'plans',
    chunk_max_lines: config.chunk_max_lines,
    chunk_strategy: config.chunk_strategy,
    manifest: config.manifest,
    project_root: config.project_root,
    completenessThresholds: config.completenessThresholds,
    default_plan_type: config.default_plan_type,
    stale_in_progress_days: config.stale_in_progress_days,
    stale_not_started_days: config.stale_not_started_days,
  };
}

async function walkDirAsync(dir: string, plansDir: string, plans: Plan[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const fileStat = await stat(fullPath);

    if (fileStat.isDirectory()) {
      const readmePath = join(fullPath, 'README.md');
      let readmeExists = false;
      try {
        await access(readmePath);
        readmeExists = true;
      } catch {
        readmeExists = false;
      }

      if (readmeExists) {
        const content = await readFile(readmePath, 'utf8');
        const result = parseFrontmatter(content);
        if (result) {
          const fileHashes: Record<string, string> = {};
          let maxMtime = (await stat(readmePath)).mtime;
          fileHashes['README.md'] = createHash('sha256').update(content).digest('hex').slice(0, 16);

          for (const fileName of PLAN_FILES) {
            if (fileName === 'README.md') continue;
            const filePath = join(fullPath, fileName);
            let fileExists = false;
            try {
              await access(filePath);
              fileExists = true;
            } catch {
              fileExists = false;
            }
            if (fileExists) {
              const fStat = await stat(filePath);
              if (fStat.mtime > maxMtime) maxMtime = fStat.mtime;
              const fileContent = await readFile(filePath, 'utf8');
              fileHashes[fileName] = createHash('sha256').update(fileContent).digest('hex').slice(0, 16);
            }
          }

          const plan: Plan = {
            id: derivePlanId(readmePath, plansDir),
            filePath: readmePath,
            frontmatter: result.frontmatter,
            body: result.body,
            lineCount: content.split('\n').length,
            updatedAt: maxMtime,
            fileHashes,
          };

          const inputsPath = join(fullPath, 'inputs.md');
          const outputsPath = join(fullPath, 'outputs.md');
          let inputsExists = false;
          try {
            await access(inputsPath);
            inputsExists = true;
          } catch {
            inputsExists = false;
          }
          if (inputsExists) {
            plan.inputs = parseInputs(await readFile(inputsPath, 'utf8'));
          }

          let outputsExists = false;
          try {
            await access(outputsPath);
            outputsExists = true;
          } catch {
            outputsExists = false;
          }
          if (outputsExists) {
            plan.outputs = parseOutputs(await readFile(outputsPath, 'utf8'));
          }

          const implPath = join(fullPath, 'implementation.md');
          let implExists = false;
          try {
            await access(implPath);
            implExists = true;
          } catch {
            implExists = false;
          }
          if (implExists) {
            const implContent = await readFile(implPath, 'utf8');
            plan.lineCount += implContent.split('\n').length;
            plan.implementationContent = implContent;
          }

          plans.push(plan);
        }
      } else {
        await walkDirAsync(fullPath, plansDir, plans);
      }
    }
  }
}

export async function scanPlansAsync(plansDir: string): Promise<Plan[]> {
  const plans: Plan[] = [];
  await walkDirAsync(plansDir, plansDir, plans);
  return plans;
}

export async function loadConfigAsync(cwd: string): Promise<TrellisConfig> {
  const configPath = join(cwd, '.trellis');

  let configExists = false;
  try {
    await access(configPath);
    configExists = true;
  } catch {
    configExists = false;
  }

  if (configExists) {
    const fileStat = await stat(configPath);

    if (fileStat.isDirectory()) {
      const dirConfigPath = join(configPath, 'config');
      let dirConfigExists = false;
      try {
        await access(dirConfigPath);
        dirConfigExists = true;
      } catch {
        dirConfigExists = false;
      }
      if (dirConfigExists) {
        const content = await readFile(dirConfigPath, 'utf8');
        return parseConfigContent(content, cwd);
      }
      return { project: basename(cwd), plans_dir: 'plans' };
    }

    const content = await readFile(configPath, 'utf8');
    process.stderr.write('Tip: run `trellis init` to upgrade to directory format.\n');
    return parseConfigContent(content, cwd);
  }

  return {
    project: basename(cwd),
    plans_dir: 'plans',
  };
}

export function loadConfig(cwd: string): TrellisConfig {
  const configPath = join(cwd, '.trellis');

  if (existsSync(configPath)) {
    const stat = statSync(configPath);

    if (stat.isDirectory()) {
      // Directory format: read .trellis/config
      const dirConfigPath = join(configPath, 'config');
      if (existsSync(dirConfigPath)) {
        const content = readFileSync(dirConfigPath, 'utf8');
        return parseConfigContent(content, cwd);
      }
      // Directory exists but no config file — use defaults
      return { project: basename(cwd), plans_dir: 'plans' };
    }

    // File format (legacy): read directly, emit upgrade hint
    const content = readFileSync(configPath, 'utf8');
    process.stderr.write('Tip: run `trellis init` to upgrade to directory format.\n');
    return parseConfigContent(content, cwd);
  }

  return {
    project: basename(cwd),
    plans_dir: 'plans',
  };
}
