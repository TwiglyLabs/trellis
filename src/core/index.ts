// --- Types ---
export type {
  PlanStatus,
  Deviation,
  PlanFrontmatter,
  ContractSection,
  PlanContract,
  Plan,
  TrellisConfig,
  ValidationError,
  GateResult,
  RepoEntry,
  ProjectManifest,
  StatusGate,
  PlanSummary,
  BlockedPlanSummary,
  CreateOptions,
} from './types.ts';

export { PlanFile, SECTION_REQUIREMENTS, STATUS_GATES, toSummary } from './types.ts';

// --- Context ---
export type { TrellisContext } from './context.ts';
export { createContext, refreshContext } from './context.ts';

// --- Scanner ---
export { scanPlans, loadConfig, derivePlanId } from './scanner.ts';

// --- Graph ---
export type {
  GraphData,
  Cycle,
  ChunkPlan,
  ChunkEdge,
  CrossChunkEdge,
  ChunkBoundaryItem,
  Chunk,
  ChunkResult,
} from './graph.ts';

export {
  buildGraph,
  detectCycles,
  topologicalSort,
  transitiveDependents,
  computeCriticalPath,
  pickNext,
  computeChunks,
  groupByDirectory,
  groupByTopologicalDepth,
  chunkContractAggregation,
  newlyReady,
} from './graph.ts';

// --- Frontmatter ---
export {
  parseFrontmatter,
  validateFrontmatter,
  readPlanFile,
  updatePlanFile,
} from './frontmatter.ts';

// --- Schema ---
export { detectSections, readSection, writeSection, validateStatusGate } from './schema.ts';

// --- Manifest ---
export type { GitExecutor, FetchRepoResult } from './manifest.ts';
export {
  parseManifest,
  ensureRemote,
  fetchRemote,
  gitShow,
  gitListTree,
  discoverManifest,
  fetchRepoPlans,
  fetchProjectPlans,
  checkVisibility,
} from './manifest.ts';

// --- Contracts ---
export { parseInputs, parseOutputs } from './contracts.ts';

// --- Utilities ---
export { VALID_STATUSES, filterPlans, validatePlanId, pluralize } from './utils.ts';
