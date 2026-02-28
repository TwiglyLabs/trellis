import { existsSync } from 'fs';
import { join } from 'path';
import { ContextStore } from './store.ts';
import { createContext } from './context.ts';
import { loadConfig } from './scanner.ts';
import { expandTilde, resolveProjectRepos, parseManifest } from './manifest.ts';
import { ensureCacheDir } from './cache.ts';
import type { GraphData } from './graph.ts';
import type { TrellisConfig, MultiRepoEntry } from './types.ts';

export interface CliContext {
  isMultiRepo: boolean;
  graph: GraphData;
  getPlansDir(alias?: string): string;
  getRepoPath(alias: string): string | undefined;
  config: TrellisConfig;
  projectDir: string;
  repoEntries?: MultiRepoEntry[];
}

/**
 * Resolve CLI context: multi-repo if a manifest is reachable, single-repo otherwise.
 *
 * Detection order:
 * 1. config.project_root → look for .trellis-project there
 * 2. config.manifest + local .trellis-project → meta-repo case
 * 3. Fallback → single-repo via createContext()
 */
export function resolveCliContext(projectDir: string): CliContext {
  const config = loadConfig(projectDir);

  // Path 1: project_root pointing to meta-repo
  if (config.project_root) {
    const projectRoot = expandTilde(config.project_root);
    const manifestPath = join(projectRoot, '.trellis-project');
    if (existsSync(manifestPath)) {
      return buildMultiRepoCliContext(projectRoot, projectDir, config);
    }
  }

  // Path 2: manifest + local .trellis-project (meta-repo case)
  if (config.manifest) {
    const manifestPath = join(projectDir, '.trellis-project');
    if (existsSync(manifestPath)) {
      return buildMultiRepoCliContext(projectDir, projectDir, config);
    }
  }

  // Path 3: single-repo fallback
  const ctx = createContext(projectDir);
  return {
    isMultiRepo: false,
    graph: ctx.graph,
    getPlansDir: () => ctx.plansDir,
    getRepoPath: () => undefined,
    config,
    projectDir,
  };
}

function buildMultiRepoCliContext(
  manifestDir: string,
  projectDir: string,
  config: TrellisConfig,
): CliContext {
  const manifestPath = join(manifestDir, '.trellis-project');
  const rawResolved = resolveProjectRepos(manifestPath);
  const specs = rawResolved
    .filter(r => r.exists)
    .map(r => ({ path: r.localPath, alias: r.alias }));

  if (specs.length === 0) {
    throw new Error(`All repos in manifest have missing paths. Check .trellis-project at ${manifestDir}`);
  }

  let cacheDir: string;
  try {
    cacheDir = ensureCacheDir(projectDir);
  } catch {
    const { mkdtempSync } = require('fs');
    const { tmpdir } = require('os');
    cacheDir = mkdtempSync(join(tmpdir(), 'trellis-cli-'));
  }

  const store = new ContextStore({ repos: specs, cacheDir, qualifyIds: true });
  const multi = store.load();

  return {
    isMultiRepo: true,
    graph: multi.graph,
    repoEntries: multi.repos,
    getPlansDir(alias?: string): string {
      if (!alias) throw new Error('Alias required in multi-repo mode.');
      const entry = multi.repos.find(r => r.alias === alias);
      if (!entry) throw new Error(`Repo "${alias}" not found in manifest. Add it to .trellis-project.`);
      if (!entry.plansDir) throw new Error(`Repo "${alias}" has no plans directory.`);
      return entry.plansDir;
    },
    getRepoPath(alias: string): string | undefined {
      return multi.repos.find(r => r.alias === alias)?.path;
    },
    config,
    projectDir,
  };
}
