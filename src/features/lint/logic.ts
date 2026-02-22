import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import matter from 'gray-matter';
import {
  detectCycles, validateFrontmatter, validateStatusGate, detectSections, writeSection, PlanFile,
  checkVisibility, parseQualifiedId,
} from '../../core/index.ts';
import type { Plan, ProjectManifest } from '../../core/types.ts';
import type { GraphData } from '../../core/graph.ts';

export interface LintIssue {
  planId: string;
  type: string;
  message: string;
}

export interface LintResult {
  ok: boolean;
  total: number;
  okCount: number;
  errors: LintIssue[];
  warnings: LintIssue[];
  structural: { errors: LintIssue[]; warnings: LintIssue[] };
  fixed: string[];
}

export interface ComputeLintOptions {
  plans: Plan[];
  graph: GraphData;
  projectDir: string;
  plansDir: string;
  /** Additional plan directories to scan for structural issues (multi-repo). */
  additionalPlansDirs?: string[];
  manifest?: ProjectManifest;
  projectName?: string;
  options?: { strict?: boolean; fix?: boolean; completeness?: boolean };
}

export function computeLint(opts: ComputeLintOptions): LintResult {
  const { plans, graph, projectDir, plansDir, options } = opts;
  const planIds = new Set(plans.map(p => p.id));
  const plansWithErrors = new Set<string>();
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const structuralErrors: LintIssue[] = [];
  const structuralWarnings: LintIssue[] = [];
  const fixed: string[] = [];

  // Cycles
  for (const cycle of detectCycles(plans)) {
    errors.push({ planId: cycle.path[0], type: 'cycle', message: `Cycle detected: ${cycle.path.join(' → ')}` });
    for (let i = 0; i < cycle.path.length - 1; i++) plansWithErrors.add(cycle.path[i]);
  }

  // Missing deps
  for (const plan of plans) {
    for (const dep of plan.frontmatter.depends_on ?? []) {
      if (!planIds.has(dep)) {
        errors.push({ planId: plan.id, type: 'missing_dependency', message: `Unknown dependency: ${plan.id} depends on "${dep}"` });
        plansWithErrors.add(plan.id);
      }
    }
  }

  // Frontmatter validation
  for (const plan of plans) {
    for (const e of validateFrontmatter(plan.id, plan.frontmatter)) {
      errors.push({ planId: plan.id, type: 'frontmatter', message: `${plan.id}: ${e.message}` });
      plansWithErrors.add(plan.id);
    }
  }

  // Inconsistencies: done plans with incomplete deps
  for (const plan of plans) {
    if (plan.frontmatter.status === 'done') {
      for (const dep of plan.frontmatter.depends_on ?? []) {
        const depPlan = plans.find(p => p.id === dep);
        if (depPlan && depPlan.frontmatter.status !== 'done') {
          errors.push({ planId: plan.id, type: 'inconsistency', message: `${plan.id} is done but depends on ${dep} (${depPlan.frontmatter.status})` });
          plansWithErrors.add(plan.id);
        }
      }
    }
  }

  // Warnings: in_progress with incomplete deps
  for (const plan of plans) {
    if (plan.frontmatter.status === 'in_progress') {
      for (const dep of plan.frontmatter.depends_on ?? []) {
        const depPlan = plans.find(p => p.id === dep);
        if (depPlan && depPlan.frontmatter.status !== 'done') {
          warnings.push({ planId: plan.id, type: 'incomplete_deps', message: `${plan.id} is in_progress but depends on ${dep} (${depPlan.frontmatter.status})` });
        }
      }
    }
  }

  // Orphans
  const dependedOn = new Set<string>();
  for (const plan of plans) {
    for (const dep of plan.frontmatter.depends_on ?? []) dependedOn.add(dep);
  }
  for (const plan of plans) {
    if (plan.frontmatter.status === 'draft' && !dependedOn.has(plan.id)) {
      warnings.push({ planId: plan.id, type: 'orphan', message: `Orphaned plan: ${plan.id} has no dependents and status is draft` });
    }
  }

  // Cross-repo: visibility violations
  if (opts.manifest) {
    const localAlias = opts.projectName ?? opts.manifest.name;
    const repoPlansMap = new Map<string, Plan[]>();
    for (const plan of plans) {
      const key = plan.repoAlias ?? localAlias;
      if (!repoPlansMap.has(key)) repoPlansMap.set(key, []);
      repoPlansMap.get(key)!.push(plan);
    }
    for (const ve of checkVisibility(opts.manifest, repoPlansMap)) {
      errors.push({ planId: ve.planId, type: 'visibility', message: ve.message });
      plansWithErrors.add(ve.planId);
    }
  }

  // Cross-repo: warn when a cross-repo dep has no outputs.md
  for (const plan of plans) {
    for (const dep of plan.frontmatter.depends_on ?? []) {
      const parsed = parseQualifiedId(dep);
      if (!parsed.repo) continue; // local dep — skip
      const depPlan = graph.plans.get(dep);
      if (depPlan && !depPlan.outputs) {
        warnings.push({ planId: plan.id, type: 'cross_repo_no_outputs', message: `Cross-repo dependency "${dep}" has no outputs.md` });
      }
    }
  }

  // --- Structural checks ---

  // Scan plans directories for malformed entries (single files, dirs without README.md)
  const allPlansDirs = [plansDir, ...(opts.additionalPlansDirs ?? [])];
  for (const dir of allPlansDirs) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { entries = []; }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (!stat.isDirectory() && entry.endsWith('.md')) {
          structuralErrors.push({ planId: entry, type: 'single_file_plan', message: `${entry} is a single file, not a plan directory` });
          plansWithErrors.add(entry);
        } else if (stat.isDirectory() && !existsSync(join(fullPath, 'README.md'))) {
          structuralErrors.push({ planId: entry, type: 'missing_readme', message: `${entry}/ is missing README.md` });
          plansWithErrors.add(entry);
        }
      } catch { /* skip unreadable entries */ }
    }
  }

  // Structural checks only apply to local plans — remote plans have
  // git-reference filePaths that don't exist on the local filesystem.
  const localPlans = plans.filter(p => !p.remote);
  for (const plan of localPlans) {
    const planDir = dirname(plan.filePath);
    const hasDependents = (graph.dependents.get(plan.id) ?? []).length > 0;
    const hasDependsOn = (plan.frontmatter.depends_on ?? []).length > 0;

    // File layout warnings
    if (hasDependsOn && !existsSync(join(planDir, PlanFile.INPUTS))) {
      structuralWarnings.push({ planId: plan.id, type: 'missing_inputs', message: `${plan.id} has depends_on but no inputs.md` });
    }
    if (hasDependents && !existsSync(join(planDir, PlanFile.OUTPUTS))) {
      structuralWarnings.push({ planId: plan.id, type: 'missing_outputs', message: `${plan.id} has dependents but no outputs.md` });
    }

    // inputs.md section warning
    if (existsSync(join(planDir, PlanFile.INPUTS))) {
      const inputsContent = readFileSync(join(planDir, PlanFile.INPUTS), 'utf8');
      const inputsSections = detectSections(inputsContent);
      const hasFromPlans = inputsSections.includes('From plans');
      const hasFromCode = inputsSections.includes('From existing code');
      if (!hasFromPlans && !hasFromCode) {
        structuralWarnings.push({ planId: plan.id, type: 'inputs_sections', message: `${plan.id} inputs.md missing "## From plans" or "## From existing code"` });
      }
    }

    // Status gate compliance
    const gate = validateStatusGate(plan, plan.frontmatter.status, hasDependents);
    if (!gate.pass) {
      for (const missing of gate.missing) {
        structuralErrors.push({ planId: plan.id, type: 'gate_violation', message: `${plan.id}: ${missing}` });
        plansWithErrors.add(plan.id);
      }

      // --fix: scaffold missing files and sections
      if (options?.fix) {
        fixStructuralIssues(plan, gate.missing, fixed);
      }
    }
  }

  // Completeness checks (opt-in via --completeness flag)
  if (options?.completeness) {
    for (const plan of plans) {
      if (!plan.completeness) continue;
      for (const [section, score] of Object.entries(plan.completeness.sections)) {
        if (score.score === 0) {
          const label = score.reason === 'missing' ? 'missing' : 'stub';
          warnings.push({ planId: plan.id, type: 'completeness', message: `${plan.id}: ${section} is ${label} (${score.wordCount} words)` });
        } else if (score.score === 50) {
          warnings.push({ planId: plan.id, type: 'completeness', message: `${plan.id}: ${section} is thin (${score.wordCount} words)` });
        }
      }
    }
  }

  const allErrors = [...errors, ...structuralErrors];
  const allWarnings = [...warnings, ...structuralWarnings];
  const ok = allErrors.length === 0 && (options?.strict ? allWarnings.length === 0 : true);

  return {
    ok,
    total: plans.length,
    okCount: plans.length - plansWithErrors.size,
    errors: allErrors,
    warnings: allWarnings,
    structural: { errors: structuralErrors, warnings: structuralWarnings },
    fixed,
  };
}

function fixStructuralIssues(plan: Plan, missing: string[], fixed: string[]): void {
  const planDir = dirname(plan.filePath);

  for (const item of missing) {
    // Missing file: implementation.md
    if (item === 'Missing file: implementation.md') {
      const implPath = join(planDir, PlanFile.IMPLEMENTATION);
      if (!existsSync(implPath)) {
        writeFileSync(implPath, '## Steps\n\n\n## Testing\n\n\n## Done-when\n\n');
        fixed.push(`${plan.id}: created implementation.md`);
      }
    }

    // Missing file: outputs.md
    if (item.startsWith('Missing file: outputs.md')) {
      const outputsPath = join(planDir, PlanFile.OUTPUTS);
      if (!existsSync(outputsPath)) {
        writeFileSync(outputsPath, '## Outputs\n\n');
        fixed.push(`${plan.id}: created outputs.md`);
      }
    }

    // Missing sections in README.md
    const readmeSectionMatch = item.match(/^README\.md: missing "## (.+)"$/);
    if (readmeSectionMatch) {
      const sectionName = readmeSectionMatch[1];
      const raw = readFileSync(plan.filePath, 'utf8');
      const parsed = matter(raw);
      const sections = detectSections(parsed.content);
      if (!sections.includes(sectionName)) {
        const newBody = writeSection(parsed.content, sectionName, '\n');
        const updated = matter.stringify(newBody, parsed.data);
        writeFileSync(plan.filePath, updated);
        fixed.push(`${plan.id}: added ## ${sectionName} to README.md`);
      }
    }

    // Missing sections in implementation.md
    const implSectionMatch = item.match(/^implementation\.md: missing "## (.+)"$/);
    if (implSectionMatch) {
      const sectionName = implSectionMatch[1];
      const implPath = join(planDir, PlanFile.IMPLEMENTATION);
      if (existsSync(implPath)) {
        const content = readFileSync(implPath, 'utf8');
        const sections = detectSections(content);
        if (!sections.includes(sectionName)) {
          const updated = writeSection(content, sectionName, '\n');
          writeFileSync(implPath, updated);
          fixed.push(`${plan.id}: added ## ${sectionName} to implementation.md`);
        }
      }
    }
  }
}
