import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

/** Map of filename → markdown content for a template type. */
export type TemplateFiles = Record<string, string>;

// --- Built-in template content ---

const FEATURE_README = `## Problem

<!-- hint: What user need or gap does this address? Include a user story if helpful. -->

## Approach

<!-- hint: How will you solve it? Note key design decisions and any migration concerns. -->
`;

const FEATURE_IMPLEMENTATION = `## Steps

<!-- hint: Ordered implementation steps. Each should be a clear, testable action. -->

## Testing

<!-- hint: How will you verify this works? Unit tests, integration tests, manual checks? -->

## Done-when

<!-- hint: Concrete acceptance criteria. When are you done? -->
`;

const BUGFIX_README = `## Problem

<!-- hint: Describe the bug. Include reproduction steps and expected vs actual behavior. What is the root cause? -->

## Approach

<!-- hint: What is the fix? Why does this approach address the root cause? -->
`;

const BUGFIX_IMPLEMENTATION = `## Steps

<!-- hint: Ordered steps to implement the fix. -->

## Testing

<!-- hint: How will you verify the bug is fixed and no regressions are introduced? -->

## Done-when

<!-- hint: When is the fix complete? Include regression criteria. -->
`;

const REFACTOR_README = `## Problem

<!-- hint: Describe the current state. What is wrong or suboptimal about it? -->

## Approach

<!-- hint: Describe the target state and the incremental migration strategy to get there. -->
`;

const REFACTOR_IMPLEMENTATION = `## Steps

<!-- hint: Ordered refactoring steps. Each should leave the codebase in a working state. -->

## Testing

<!-- hint: How will you verify the refactor preserves existing behavior? -->

## Done-when

<!-- hint: When is the refactor complete? What does the target state look like? -->
`;

const INVESTIGATION_README = `## Problem

<!-- hint: What question are you trying to answer? State your hypothesis. -->

## Approach

<!-- hint: What methodology will you use to investigate? What will you examine? -->

## Findings

<!-- hint: Record what you discovered. This section is filled in during the investigation. -->
`;

export const BUILT_IN_TEMPLATES: Record<string, TemplateFiles> = {
  feature: {
    'README.md': FEATURE_README,
    'implementation.md': FEATURE_IMPLEMENTATION,
  },
  bugfix: {
    'README.md': BUGFIX_README,
    'implementation.md': BUGFIX_IMPLEMENTATION,
  },
  refactor: {
    'README.md': REFACTOR_README,
    'implementation.md': REFACTOR_IMPLEMENTATION,
  },
  investigation: {
    'README.md': INVESTIGATION_README,
  },
};

export const BUILT_IN_TEMPLATE_NAMES = Object.keys(BUILT_IN_TEMPLATES);

/**
 * Load a template by type. Checks .trellis/templates/<type>/ first,
 * falls back to built-in constant. Returns null if type is unknown.
 */
export function loadTemplate(projectDir: string, type: string): TemplateFiles | null {
  const customDir = join(projectDir, '.trellis', 'templates', type);

  if (existsSync(customDir)) {
    const files: TemplateFiles = {};
    for (const entry of readdirSync(customDir)) {
      if (entry.endsWith('.md')) {
        files[entry] = readFileSync(join(customDir, entry), 'utf8');
      }
    }
    if (Object.keys(files).length > 0) {
      return files;
    }
  }

  return BUILT_IN_TEMPLATES[type] ?? null;
}

/**
 * List available template types (built-in + custom).
 */
export function listTemplateTypes(projectDir: string): string[] {
  const types = new Set(BUILT_IN_TEMPLATE_NAMES);

  const templatesDir = join(projectDir, '.trellis', 'templates');
  if (existsSync(templatesDir)) {
    for (const entry of readdirSync(templatesDir)) {
      const entryPath = join(templatesDir, entry);
      try {
        if (statSync(entryPath).isDirectory()) {
          types.add(entry);
        }
      } catch {
        // skip
      }
    }
  }

  return [...types].sort();
}

/** Strip <!-- hint: ... --> comments from template content. */
export function stripHints(content: string): string {
  return content.replace(/<!--\s*hint:.*?-->\n?/gs, '');
}

/**
 * Write built-in templates to .trellis/templates/ during init.
 * Skips types whose directory already exists.
 */
export function writeBuiltInTemplates(projectDir: string): string[] {
  const templatesDir = join(projectDir, '.trellis', 'templates');
  const written: string[] = [];

  for (const [type, files] of Object.entries(BUILT_IN_TEMPLATES)) {
    const typeDir = join(templatesDir, type);
    if (existsSync(typeDir)) {
      continue; // don't overwrite user customizations
    }

    mkdirSync(typeDir, { recursive: true });
    for (const [filename, content] of Object.entries(files)) {
      writeFileSync(join(typeDir, filename), content);
    }
    written.push(type);
  }

  return written;
}
