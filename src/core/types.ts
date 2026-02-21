export type PlanStatus = 'draft' | 'not_started' | 'in_progress' | 'done' | 'archived';

export type Deviation = 'none' | 'minor' | 'major';

export interface PlanFrontmatter {
  title: string;
  status: PlanStatus;
  depends_on?: string[];
  tags?: string[];
  repo?: string;
  description?: string;
  assignee?: string;
  started_at?: string;
  completed_at?: string;
  not_started_at?: string;
  sessions?: number;
  deviation?: Deviation;
  type?: string;
}

export interface ContractSection {
  heading: string;
  items: string[];
  source?: string;  // for inputs: the plan ID this comes from
}

export interface PlanContract {
  raw: string;
  fromPlans: string[];
  fromCode: string[];
  sections: ContractSection[];
}

export interface Plan {
  id: string;
  filePath: string;
  frontmatter: PlanFrontmatter;
  body: string;
  lineCount: number;
  updatedAt: Date;
  fileHashes: Record<string, string>;
  implementationContent?: string;
  completeness?: CompletenessResult;
  inputs?: PlanContract;
  outputs?: PlanContract;
  repoAlias?: string;
}

export interface TrellisConfig {
  project: string;
  plans_dir: string;
  chunk_max_lines?: number;
  chunk_strategy?: 'directory' | 'topological';
  manifest?: string;
  completenessThresholds?: Record<string, number>;
  default_plan_type?: string;
}

export interface RepoEntry {
  url: string;
  branch: string;
  visibility: 'public' | 'private';
}

export interface ProjectManifest {
  name: string;
  repos: Record<string, RepoEntry>;
}

// --- Completeness scoring ---

export interface SectionScore {
  score: 0 | 50 | 100;
  wordCount: number;
  reason: 'missing' | 'placeholder' | 'thin' | 'complete';
}

export interface CompletenessResult {
  sections: Record<string, SectionScore>;
  aggregate: number; // 0–100, mean of applicable sections
}

export interface RecentActivity {
  contentChanged: Plan[];
  statusChanged: Plan[];
  newlyCreated: Plan[];
}

export interface ValidationError {
  planId: string;
  field: string;
  message: string;
}

// --- Plan Schema ---

/** Well-known files in a plan directory */
export enum PlanFile {
  README = 'README.md',
  IMPLEMENTATION = 'implementation.md',
  INPUTS = 'inputs.md',
  OUTPUTS = 'outputs.md',
}

/** Required ## headings per plan file */
export const SECTION_REQUIREMENTS: Record<PlanFile, string[]> = {
  [PlanFile.README]: ['Problem', 'Approach'],
  [PlanFile.IMPLEMENTATION]: ['Steps', 'Testing', 'Done-when'],
  [PlanFile.INPUTS]: ['From plans', 'From existing code'],  // at least one required
  [PlanFile.OUTPUTS]: [],  // at least one ## heading required, but no specific names
};

/** What's required for each status transition */
export interface StatusGate {
  requiredFiles: PlanFile[];
  requiredSections: Partial<Record<PlanFile, string[]>>;
  /** Custom check name → description (e.g., outputs.md required if has dependents) */
  conditionalChecks?: string[];
}

export const STATUS_GATES: Record<PlanStatus, StatusGate> = {
  draft: {
    requiredFiles: [PlanFile.README],
    requiredSections: {
      [PlanFile.README]: ['Problem'],
    },
  },
  not_started: {
    requiredFiles: [PlanFile.README, PlanFile.IMPLEMENTATION],
    requiredSections: {
      [PlanFile.README]: ['Problem', 'Approach'],
      [PlanFile.IMPLEMENTATION]: ['Steps', 'Testing', 'Done-when'],
    },
  },
  in_progress: {
    requiredFiles: [PlanFile.README, PlanFile.IMPLEMENTATION],
    requiredSections: {
      [PlanFile.README]: ['Problem', 'Approach'],
      [PlanFile.IMPLEMENTATION]: ['Steps', 'Testing', 'Done-when'],
    },
  },
  done: {
    requiredFiles: [PlanFile.README, PlanFile.IMPLEMENTATION],
    requiredSections: {
      [PlanFile.README]: ['Problem', 'Approach'],
      [PlanFile.IMPLEMENTATION]: ['Steps', 'Testing', 'Done-when'],
    },
    conditionalChecks: ['outputs.md required if plan has dependents'],
  },
  archived: {
    requiredFiles: [],
    requiredSections: {},
  },
};

export interface GateResult {
  pass: boolean;
  missing: string[];
}

// --- Cache ---

export interface CacheEntry<T> {
  data: T;
  fetchedAt: string;  // ISO 8601
}

// --- Multi-repo context ---

export interface RepoSpec {
  path: string;   // absolute path to repo root
  alias: string;  // short name used to prefix plan IDs
}

export interface MultiRepoEntry {
  alias: string;
  path: string;
  planCount: number;
  configFound: boolean;
  error?: string;
}

// --- Shared API types ---

export interface PlanSummary {
  id: string;
  title: string;
  status: PlanStatus;
  description?: string;
  tags: string[];
  repo?: string;
  assignee?: string;
  repoAlias?: string;
  type?: string;
}

export interface BlockedPlanSummary extends PlanSummary {
  waitingOn: string[];
}

export type CreateOptions = {
  title: string;
  description?: string;
  depends_on?: string[];
  tags?: string[];
  type?: string;
};

/** Convert a Plan to a PlanSummary. */
export function toSummary(p: Plan): PlanSummary {
  return {
    id: p.id,
    title: p.frontmatter.title,
    status: p.frontmatter.status,
    description: p.frontmatter.description,
    tags: p.frontmatter.tags ?? [],
    repo: p.frontmatter.repo,
    assignee: p.frontmatter.assignee,
    repoAlias: p.repoAlias,
    type: p.frontmatter.type,
  };
}
