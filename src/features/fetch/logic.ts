import { discoverManifest, fetchProjectPlans } from '../../core/index.ts';
import type { TrellisConfig, Plan } from '../../core/types.ts';
import type { GitExecutor } from '../../core/manifest.ts';

export interface RepoFetchStatus {
  alias: string;
  ok: boolean;
  planCount: number;
  error?: string;
}

export interface FetchResult {
  project: string;
  repos: RepoFetchStatus[];
  totalPlans: number;
}

export interface ComputeFetchOptions {
  config: TrellisConfig;
  projectDir: string;
  git?: GitExecutor;
}

export function computeFetch(opts: ComputeFetchOptions): FetchResult {
  const { config, projectDir, git } = opts;

  if (!config.manifest) {
    throw new Error('No manifest configured. Add "manifest: <git-url>" to .trellis');
  }

  const manifest = discoverManifest(config.manifest, projectDir, git);
  if (!manifest) {
    throw new Error('Failed to discover project manifest. Check manifest URL and network access.');
  }

  const remotePlans = fetchProjectPlans(manifest, config.project, projectDir, git);
  const repos: RepoFetchStatus[] = [];
  let totalPlans = 0;

  for (const [alias] of Object.entries(manifest.repos)) {
    if (alias === config.project) continue;
    const plans = remotePlans.get(alias);
    if (plans) {
      repos.push({ alias, ok: true, planCount: plans.length });
      totalPlans += plans.length;
    } else {
      repos.push({ alias, ok: false, planCount: 0, error: `Failed to fetch plans from "${alias}"` });
    }
  }

  return { project: manifest.name, repos, totalPlans };
}

export function computeProjectPlans(opts: ComputeFetchOptions): Map<string, Plan[]> | null {
  const { config, projectDir, git } = opts;

  if (!config.manifest) return null;

  const manifest = discoverManifest(config.manifest, projectDir, git);
  if (!manifest) return null;

  return fetchProjectPlans(manifest, config.project, projectDir, git);
}
