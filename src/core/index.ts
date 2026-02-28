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
export type { TrellisContext, CreateContextOptions, MultiContextOptions, MultiContext } from './context.ts';
export { createContext, refreshContext, createContextAsync, refreshContextAsync, mergeWithRemote, createMultiContext, createMultiContextAsync, attachCompleteness, applyBatch } from './context.ts';

// --- Cached Context ---
export type { CachedContextOptions, CachedContextResult } from './cached-context.ts';
export { createCachedContext, createCachedContextAsync } from './cached-context.ts';

// --- Scanner ---
export { scanPlans, scanPlansAsync, loadConfig, loadConfigAsync, parseConfigContent, derivePlanId } from './scanner.ts';

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
export type { GitExecutor, AsyncGitExecutor, FetchRepoResult, AsyncFetchRepoResult } from './manifest.ts';
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
  defaultAsyncGit,
  ensureRemoteAsync,
  fetchRemoteAsync,
  gitShowAsync,
  gitListTreeAsync,
  discoverManifestAsync,
  fetchRepoPlansAsync,
  resolveProjectReposAsync,
} from './manifest.ts';

// --- Contracts ---
export { parseInputs, parseOutputs } from './contracts.ts';

// --- Cache ---
export { ensureCacheDir, readCache, writeCache, isCacheStale } from './cache.ts';

// --- Mutex ---
export { createFileLock } from './mutex.ts';

// --- Context Store ---
export { ContextStore, computeMtimeHash, computeMtimeHashAsync } from './store.ts';
export type { ContextStoreOptions } from './store.ts';

// --- Worktree ---
export type { WorktreeInfo } from './worktree.ts';
export { detectWorktree, detectWorktreeAsync, applyWorktreeOverride, applyWorktreeOverrideAsync } from './worktree.ts';

// --- Utilities ---
export type { ResolvedPlanId } from './utils.ts';
export { VALID_STATUSES, filterPlans, resolveIsProject, buildReposArray, validatePlanId, parseQualifiedId, dequalifyDepsForWrite, resolvePlanId, pluralize } from './utils.ts';
