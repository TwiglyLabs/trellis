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
  ResolvedRepo,
  StatusGate,
  PlanSummary,
  BlockedPlanSummary,
  CreateOptions,
  RepoSpec,
  MultiRepoEntry,
  BlockingPlan,
  StuckPlan,
  StalePlan,
  LayerPressure,
  HealthSummary,
  BottleneckResult,
  PlanIndex,
  RepoIndexEntry,
} from './types.ts';

export { PlanFile, SECTION_REQUIREMENTS, STATUS_GATES, toSummary } from './types.ts';

// --- Context ---
export type { TrellisContext, CreateContextOptions, MultiContext } from './context.ts';
export { createContext, refreshContext, mergeWithRemote, createMultiContext, attachCompleteness, applyBatch } from './context.ts';

// --- Cached Context ---
export type { CachedContextOptions, CachedContextResult } from './cached-context.ts';
export { createCachedContext } from './cached-context.ts';

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
  patchGraph,
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
  resolveProjectRepos,
  expandTilde,
} from './manifest.ts';

// --- Contracts ---
export { parseInputs, parseOutputs } from './contracts.ts';

// --- Cache ---
export { ensureCacheDir, readCache, writeCache, isCacheStale } from './cache.ts';

// --- Mutex ---
export { createFileLock } from './mutex.ts';

// --- Context Store ---
export { ContextStore, computeMtimeHash } from './store.ts';
export type { ContextStoreOptions } from './store.ts';

// --- Utilities ---
export type { ResolvedPlanId } from './utils.ts';
export { VALID_STATUSES, filterPlans, resolveIsProject, buildReposArray, validatePlanId, parseQualifiedId, resolvePlanId, pluralize } from './utils.ts';
