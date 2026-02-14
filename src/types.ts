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

export interface Plan {
  id: string;
  filePath: string;
  frontmatter: PlanFrontmatter;
  body: string;
  lineCount: number;
}

export interface TrellisConfig {
  project: string;
  plans_dir: string;
  chunk_max_lines?: number;
}

export interface ValidationError {
  planId: string;
  field: string;
  message: string;
}
