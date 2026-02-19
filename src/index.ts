// --- Types ---
export type {
  PlanStatus,
  PlanFrontmatter,
  ContractSection,
  PlanContract,
  Plan,
  TrellisConfig,
  ValidationError,
  GateResult,
  RepoEntry,
  ProjectManifest,
} from './types.ts';

export { PlanFile, SECTION_REQUIREMENTS, STATUS_GATES } from './types.ts';

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
export { VALID_STATUSES, filterPlans } from './utils.ts';

// --- High-Level API ---
export { Trellis } from './api.ts';
export type {
  StatusResult,
  PlanSummary,
  BlockedPlanSummary,
  ReadyResult,
  DependencyInfo,
  ShowResult,
  UpdateResult,
  LintIssue,
  LintResult,
  GraphNode,
  GraphEdge,
  GraphResult,
  EpicResult,
  CreateResult,
  CreateOptions,
  SetResult,
  WriteSectionResult,
  ReadSectionResult,
  RenameResult,
  ArchiveResult,
  FetchResult,
  RepoFetchStatus,
} from './api.ts';
