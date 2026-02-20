import { join } from 'path';
import { loadConfig, scanPlans } from './scanner.ts';
import { buildGraph } from './graph.ts';
import type { Plan, TrellisConfig } from './types.ts';
import type { GraphData } from './graph.ts';

export interface TrellisContext {
  readonly projectDir: string;
  readonly config: TrellisConfig;
  readonly plansDir: string;
  readonly plans: Plan[];
  readonly graph: GraphData;
}

/** Build a full TrellisContext from a project directory. */
export function createContext(projectDir: string): TrellisContext {
  const config = loadConfig(projectDir);
  const plansDir = join(projectDir, config.plans_dir);
  const plans = scanPlans(plansDir);
  const graph = buildGraph(plans);
  return { projectDir, config, plansDir, plans, graph };
}

/** Re-scan plans and rebuild the graph, preserving config. */
export function refreshContext(ctx: TrellisContext): TrellisContext {
  const plans = scanPlans(ctx.plansDir);
  const graph = buildGraph(plans);
  return { ...ctx, plans, graph };
}
