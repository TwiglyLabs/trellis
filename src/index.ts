// --- Types ---
export type {
  PlanStatus,
  PlanFrontmatter,
  ContractSection,
  PlanContract,
  Plan,
  TrellisConfig,
  ValidationError,
} from './types.ts';

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

// --- Contracts ---
export { parseInputs, parseOutputs } from './contracts.ts';

// --- Utilities ---
export { VALID_STATUSES, filterPlans } from './utils.ts';
