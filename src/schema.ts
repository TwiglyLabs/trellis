import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import type { Plan, PlanStatus, GateResult } from './types.ts';
import { PlanFile, STATUS_GATES } from './types.ts';

/**
 * Extract ## headings from markdown content.
 * Ignores headings inside fenced code blocks.
 */
export function detectSections(content: string): string[] {
  const sections: string[] = [];
  let inCodeBlock = false;

  for (const line of content.split('\n')) {
    // Track fenced code blocks (``` or ~~~)
    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      sections.push(match[1].trim());
    }
  }

  return sections;
}

/**
 * Validate whether a plan meets the gate requirements for a target status.
 *
 * @param plan - The plan to validate
 * @param targetStatus - The status being transitioned to
 * @param hasDependents - Whether this plan has other plans depending on it
 */
export function validateStatusGate(
  plan: Plan,
  targetStatus: PlanStatus,
  hasDependents = false,
): GateResult {
  const gate = STATUS_GATES[targetStatus];
  const missing: string[] = [];
  const planDir = dirname(plan.filePath);

  // Check required files exist
  for (const file of gate.requiredFiles) {
    const filePath = join(planDir, file);
    if (!existsSync(filePath)) {
      missing.push(`Missing file: ${file}`);
    }
  }

  // Check required sections in each file
  for (const [file, requiredSections] of Object.entries(gate.requiredSections)) {
    const filePath = join(planDir, file);
    if (!existsSync(filePath)) continue; // Already reported as missing file

    const content = readFileSync(filePath, 'utf8');
    const sections = detectSections(content);

    if (file === PlanFile.INPUTS) {
      // inputs.md requires at least one of "From plans" or "From existing code"
      const hasFromPlans = sections.some(s => s === 'From plans');
      const hasFromCode = sections.some(s => s === 'From existing code');
      if (!hasFromPlans && !hasFromCode) {
        missing.push(`${file}: requires "## From plans" and/or "## From existing code"`);
      }
    } else {
      for (const section of requiredSections!) {
        if (!sections.includes(section)) {
          missing.push(`${file}: missing "## ${section}"`);
        }
      }
    }
  }

  // Conditional checks
  if (targetStatus === 'done' && hasDependents) {
    const outputsPath = join(planDir, PlanFile.OUTPUTS);
    if (!existsSync(outputsPath)) {
      missing.push('Missing file: outputs.md (required because this plan has dependents)');
    } else {
      const content = readFileSync(outputsPath, 'utf8');
      const sections = detectSections(content);
      if (sections.length === 0) {
        missing.push('outputs.md: requires at least one ## heading');
      }
    }
  }

  return {
    pass: missing.length === 0,
    missing,
  };
}
