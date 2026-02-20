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
 * Find ## heading boundaries in markdown content, respecting fenced code blocks.
 * Returns array of { name, contentStart, contentEnd } where contentStart is the
 * char offset after the heading line's newline, and contentEnd is the char offset
 * of the next ## heading line (or content.length).
 */
function findSectionBoundaries(content: string): Array<{ name: string; headingStart: number; contentStart: number; contentEnd: number }> {
  const sections: Array<{ name: string; headingStart: number; contentStart: number; contentEnd: number }> = [];
  const lines = content.split('\n');
  let inCodeBlock = false;
  let offset = 0;

  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
    } else if (!inCodeBlock) {
      const match = line.match(/^##\s+(.+)$/);
      if (match) {
        // Close previous section
        if (sections.length > 0) {
          sections[sections.length - 1].contentEnd = offset;
        }
        sections.push({
          name: match[1].trim(),
          headingStart: offset,
          contentStart: offset + line.length + 1, // after the heading line + newline
          contentEnd: content.length, // will be updated when next section found
        });
      }
    }
    offset += line.length + 1; // +1 for the \n
  }

  return sections;
}

/**
 * Read content of a specific section from markdown body (post-frontmatter).
 * Returns section content between its ## heading and the next ## heading (or EOF).
 * Returns null if the section is not found. Returns full content if no section specified.
 * Subheadings (###, ####) are treated as part of the parent ## section.
 */
export function readSection(content: string, sectionName?: string): string | null {
  if (sectionName === undefined) return content;

  const sections = findSectionBoundaries(content);
  const section = sections.find(s => s.name === sectionName);
  if (!section) return null;

  return content.slice(section.contentStart, section.contentEnd);
}

/**
 * Write content into a specific section of markdown body (post-frontmatter).
 * Replaces everything between the ## heading and the next ## heading.
 * If the section doesn't exist, appends it at the end.
 */
export function writeSection(content: string, sectionName: string, newContent: string): string {
  const sections = findSectionBoundaries(content);
  const section = sections.find(s => s.name === sectionName);

  if (section) {
    // Replace content between heading and next heading
    const before = content.slice(0, section.contentStart);
    const after = content.slice(section.contentEnd);
    return before + newContent + after;
  }

  // Section not found — append
  const separator = content.length > 0 && !content.endsWith('\n') ? '\n\n' : '\n';
  return content + separator + `## ${sectionName}\n${newContent}`;
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
