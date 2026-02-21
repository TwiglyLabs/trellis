import type { Plan } from '../../core/types.ts';

/** Well-known files within a plan directory. */
export type PlanFileKind = 'readme' | 'implementation' | 'inputs' | 'outputs';

/** Mapping from filename to PlanFileKind. */
export const FILE_KIND_MAP: Record<string, PlanFileKind> = {
  'README.md': 'readme',
  'implementation.md': 'implementation',
  'inputs.md': 'inputs',
  'outputs.md': 'outputs',
};

/** A single change event for a plan. */
export type PlanChangeEvent =
  | { type: 'plan-added'; planId: string; plan: Plan }
  | { type: 'plan-removed'; planId: string }
  | { type: 'plan-updated'; planId: string; file: PlanFileKind; plan: Plan };

/** A batch of debounced plan change events. */
export interface PlanChangeBatch {
  events: PlanChangeEvent[];
  timestamp: Date;
}

/** Handle returned by watch functions; call close() to stop watching. */
export interface WatchHandle {
  close(): void;
}

/** Resolved path information from a raw filesystem event. */
export interface ResolvedPath {
  planId: string;
  fileKind: PlanFileKind;
  absolutePath: string;
}
