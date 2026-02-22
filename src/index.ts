// --- Core (shared modules) ---
export type {
  PlanStatus,
  Deviation,
  PlanFrontmatter,
  ContractSection,
  PlanContract,
  Plan,
  RecentActivity,
  TrellisConfig,
  ValidationError,
  GateResult,
  SectionScore,
  CompletenessResult,
  RepoEntry,
  ProjectManifest,
  ResolvedRepo,
  StatusGate,
  TrellisContext,
  MultiContext,
  RepoSpec,
  MultiRepoEntry,
  GraphData,
  Cycle,
  ChunkPlan,
  ChunkEdge,
  CrossChunkEdge,
  ChunkBoundaryItem,
  Chunk,
  ChunkResult,
  GitExecutor,
  FetchRepoResult,
  PlanSummary,
  BlockedPlanSummary,
  CreateOptions,
  CacheEntry,
  PlanIndex,
  RepoIndexEntry,
  BlockingPlan,
  StuckPlan,
  StalePlan,
  LayerPressure,
  HealthSummary,
  BottleneckResult,
} from './core/index.ts';

export {
  PlanFile, SECTION_REQUIREMENTS, STATUS_GATES,
  createContext, refreshContext, createMultiContext, attachCompleteness, applyBatch, toSummary,
  scanPlans, loadConfig, parseConfigContent, derivePlanId,
  buildGraph, detectCycles, topologicalSort, transitiveDependents,
  computeCriticalPath, pickNext, computeChunks, groupByDirectory,
  groupByTopologicalDepth, chunkContractAggregation, newlyReady, patchGraph,
  parseFrontmatter, validateFrontmatter, readPlanFile, updatePlanFile,
  detectSections, readSection, writeSection, validateStatusGate,
  computeCompleteness, DEFAULT_THRESHOLDS, PLACEHOLDER_PATTERNS,
  parseManifest, ensureRemote, fetchRemote, gitShow, gitListTree,
  discoverManifest, fetchRepoPlans, fetchProjectPlans, checkVisibility, resolveProjectRepos,
  parseInputs, parseOutputs,
  VALID_STATUSES, filterPlans,
  ensureCacheDir, readCache, writeCache, isCacheStale,
  ContextStore, computeMtimeHash,
} from './core/index.ts';

// --- Feature compute functions ---
export { computeStatus } from './features/status/logic.ts';
export type { StatusResult } from './features/status/logic.ts';

export { computeReady } from './features/ready/logic.ts';
export type { ReadyResult } from './features/ready/logic.ts';

export { computeShow } from './features/show/logic.ts';
export type { DependencyInfo, ShowResult } from './features/show/logic.ts';

export { computeUpdate } from './features/update/logic.ts';
export type { UpdateResult } from './features/update/logic.ts';

export { computeLint } from './features/lint/logic.ts';
export type { LintIssue, LintResult } from './features/lint/logic.ts';

export { computeGraph } from './features/graph/logic.ts';
export type { GraphNode, GraphEdge, GraphResult } from './features/graph/logic.ts';

export { computeEpic } from './features/epic/logic.ts';
export type { EpicResult } from './features/epic/logic.ts';

export { computeCreate } from './features/create/logic.ts';
export type { CreateResult } from './features/create/logic.ts';

export { computeSet } from './features/set/logic.ts';
export type { SetResult } from './features/set/logic.ts';

export { computeWriteSection, computeWriteSections, computeReadSection } from './features/sections/logic.ts';
export type { WriteSectionResult, WriteSectionsResult, ReadSectionResult } from './features/sections/logic.ts';

export { computeRename } from './features/rename/logic.ts';
export type { RenameResult } from './features/rename/logic.ts';

export { computeArchive } from './features/archive/logic.ts';
export type { ArchiveResult } from './features/archive/logic.ts';

export { computeFetch, computeProjectPlans } from './features/fetch/logic.ts';
export type { FetchResult, RepoFetchStatus } from './features/fetch/logic.ts';

export { computeMetrics } from './features/metrics/logic.ts';
export type { PlanMetric, MetricsResult } from './features/metrics/logic.ts';

export { computeChunksFeature } from './features/chunks/logic.ts';

export { computeRecent } from './features/recent/logic.ts';
export type { RecentResult, RecentPlanEntry } from './features/recent/logic.ts';

export { computeRecentActivity } from './recency.ts';

export { computeBottlenecks } from './features/bottlenecks/logic.ts';
export type { ComputeBottlenecksOptions } from './features/bottlenecks/logic.ts';

// --- Watch ---
export { watchPlans, unwatchPlans, watchMultiRepo } from './features/watch/logic.ts';
export type { PlanFileKind, PlanChangeEvent, PlanChangeBatch, WatchHandle } from './features/watch/types.ts';
