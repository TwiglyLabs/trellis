export type PlanStatus = 'draft' | 'not_started' | 'in_progress' | 'done' | 'archived';

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
  inputs?: PlanContract;
  outputs?: PlanContract;
}

export interface TrellisConfig {
  project: string;
  plans_dir: string;
  chunk_max_lines?: number;
  chunk_strategy?: 'directory' | 'topological';
}

export interface ValidationError {
  planId: string;
  field: string;
  message: string;
}
