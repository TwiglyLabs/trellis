// --- Types ---
export type {
  PlanStatus,
  Deviation,
  PlanFrontmatter,
  ContractSection,
  PlanContract,
  Plan,
  RecentActivity,
  TrellisConfig,
  CacheEntry,
  ValidationError,
  GateResult,
  SectionScore,
  CompletenessResult,
  RepoEntry,
  ProjectManifest,
  StatusGate,
  PlanSummary,
  BlockedPlanSummary,
  CreateOptions,
  RepoSpec,
  MultiRepoEntry,
} from './types.ts';

export { PlanFile, SECTION_REQUIREMENTS, STATUS_GATES, toSummary } from './types.ts';

// --- Context ---
export type { TrellisContext, CreateContextOptions, MultiContext } from './context.ts';
export { createContext, refreshContext, mergeWithRemote, createMultiContext } from './context.ts';

// --- Scanner ---
export { scanPlans, loadConfig, parseConfigContent, derivePlanId } from './scanner.ts';

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

// --- Completeness ---
export { computeCompleteness, DEFAULT_THRESHOLDS, PLACEHOLDER_PATTERNS } from './completeness.ts';

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

// --- Cache ---
export { ensureCacheDir, readCache, writeCache, isCacheStale } from './cache.ts';

// --- Mutex ---
export { createFileLock } from './mutex.ts';

// --- Utilities ---
export { VALID_STATUSES, filterPlans, resolveProjectPlans, buildReposArray, validatePlanId, parseQualifiedId, pluralize } from './utils.ts';
