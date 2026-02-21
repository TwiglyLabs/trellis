import { readSection } from './schema.ts';
import type { Plan, TrellisConfig, SectionScore, CompletenessResult } from './types.ts';

/** Default word-count thresholds per section. */
export const DEFAULT_THRESHOLDS: Record<string, { low: number; high: number }> = {
  'Problem':   { low: 20, high: 50 },
  'Approach':  { low: 20, high: 60 },
  'Steps':     { low: 30, high: 80 },
  'Testing':   { low: 15, high: 40 },
  'Done-when': { low: 10, high: 25 },
};

/** Patterns that force a score of 0 when matched in section body. */
export const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bTBD\b/i,
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bplaceholder\b/i,
  /\bcoming\s+soon\b/i,
];

/** Config key name mapping: section → config prefix */
const SECTION_CONFIG_MAP: Record<string, string> = {
  'Problem':   'completeness_problem',
  'Approach':  'completeness_approach',
  'Steps':     'completeness_steps',
  'Testing':   'completeness_testing',
  'Done-when': 'completeness_done_when',
};

/** Which sections are expected at each status. */
const STATUS_SECTIONS: Record<string, string[]> = {
  draft:       ['Problem'],
  not_started: ['Problem', 'Approach', 'Steps', 'Testing', 'Done-when'],
  in_progress: ['Problem', 'Approach', 'Steps', 'Testing', 'Done-when'],
  done:        ['Problem', 'Approach', 'Steps', 'Testing', 'Done-when'],
  archived:    [],
};

/** Sections that live in implementation.md rather than README.md body. */
const IMPL_SECTIONS = new Set(['Steps', 'Testing', 'Done-when']);

function getThresholds(
  section: string,
  config: TrellisConfig,
): { low: number; high: number } {
  const defaults = DEFAULT_THRESHOLDS[section] ?? { low: 20, high: 50 };
  const prefix = SECTION_CONFIG_MAP[section];
  if (!prefix || !config.completenessThresholds) return defaults;

  const lowKey = `${prefix}_low`;
  const highKey = `${prefix}_high`;
  return {
    low: config.completenessThresholds[lowKey] ?? defaults.low,
    high: config.completenessThresholds[highKey] ?? defaults.high,
  };
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function isPlaceholder(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  return PLACEHOLDER_PATTERNS.some(p => p.test(trimmed));
}

function scoreSection(
  sectionBody: string | null,
  section: string,
  config: TrellisConfig,
): SectionScore {
  if (sectionBody === null) {
    return { score: 0, wordCount: 0, reason: 'missing' };
  }

  if (isPlaceholder(sectionBody)) {
    return { score: 0, wordCount: countWords(sectionBody), reason: 'placeholder' };
  }

  const wordCount = countWords(sectionBody);
  const { low, high } = getThresholds(section, config);

  if (wordCount < low) {
    return { score: 0, wordCount, reason: 'placeholder' };
  }

  if (wordCount >= high) {
    return { score: 100, wordCount, reason: 'complete' };
  }

  return { score: 50, wordCount, reason: 'thin' };
}

/**
 * Compute completeness scores for a plan's sections.
 * Sections expected depend on the plan's current status.
 */
export function computeCompleteness(
  plan: Plan,
  config: TrellisConfig,
): CompletenessResult {
  const status = plan.frontmatter.status;
  const expectedSections = STATUS_SECTIONS[status] ?? [];

  const sections: Record<string, SectionScore> = {};

  for (const section of expectedSections) {
    let sectionBody: string | null;

    if (IMPL_SECTIONS.has(section)) {
      // Read from implementation.md content if available
      const implContent = plan.implementationContent;
      sectionBody = implContent ? readSection(implContent, section) : null;
    } else {
      // Read from README body
      sectionBody = readSection(plan.body, section);
    }

    sections[section] = scoreSection(sectionBody, section, config);
  }

  // Compute aggregate: mean of all section scores
  const scores = Object.values(sections);
  const aggregate = scores.length > 0
    ? Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length)
    : 0;

  return { sections, aggregate };
}
