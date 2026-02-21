import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import matter from 'gray-matter';
import {
  parseFrontmatter,
  readSection, writeSection,
  PlanFile,
} from '../../core/index.ts';
import type { GraphData } from '../../core/graph.ts';

export interface WriteSectionResult {
  id: string;
  file: string;
  section: string;
  content: string;
}

export interface ReadSectionResult {
  id: string;
  file?: string;
  section?: string;
  content: string;
}

const FILE_NAME_MAP: Record<string, PlanFile> = {
  readme: PlanFile.README,
  implementation: PlanFile.IMPLEMENTATION,
  inputs: PlanFile.INPUTS,
  outputs: PlanFile.OUTPUTS,
};

export interface ComputeWriteSectionOptions {
  planId: string;
  file: string;
  section: string;
  content: string;
  graph: GraphData;
}

export interface ComputeReadSectionOptions {
  planId: string;
  file?: string;
  section?: string;
  graph: GraphData;
}

export interface SectionCallbacks {
  refresh: () => void;
}

export function computeWriteSection(options: ComputeWriteSectionOptions, callbacks: SectionCallbacks): WriteSectionResult {
  const { planId, file, section, content, graph } = options;

  const plan = graph.plans.get(planId);
  if (!plan) throw new Error(`Plan "${planId}" not found.`);
  if (plan.remote) {
    throw new Error(`Cannot modify remote plan '${planId}'. Write operations are local only.`);
  }

  const fileName = FILE_NAME_MAP[file];
  if (!fileName) throw new Error(`Invalid file "${file}". Must be one of: ${Object.keys(FILE_NAME_MAP).join(', ')}`);

  const planDir = dirname(plan.filePath);
  const filePath = join(planDir, fileName);

  if (fileName === PlanFile.README) {
    // For README, we need to preserve frontmatter
    const raw = readFileSync(filePath, 'utf8');
    const parsed = matter(raw);
    const newBody = writeSection(parsed.content, section, content);
    const updated = matter.stringify(newBody, parsed.data);
    writeFileSync(filePath, updated);
  } else {
    // For non-README files, create if missing (only inputs/outputs)
    let existing = '';
    if (existsSync(filePath)) {
      existing = readFileSync(filePath, 'utf8');
    } else {
      // Create the file (implementation, inputs, outputs)
      existing = '';
    }
    const updated = writeSection(existing, section, content);
    writeFileSync(filePath, updated);
  }

  callbacks.refresh();
  return { id: planId, file, section, content };
}

export interface ComputeWriteSectionsOptions {
  planId: string;
  writes: Array<{ file: string; section: string; content: string }>;
  graph: GraphData;
}

export interface WriteSectionsResult {
  id: string;
  writes: Array<{ file: string; section: string }>;
}

export function computeWriteSections(options: ComputeWriteSectionsOptions, callbacks: SectionCallbacks): WriteSectionsResult {
  const { planId, writes, graph } = options;

  const plan = graph.plans.get(planId);
  if (!plan) throw new Error(`Plan "${planId}" not found.`);
  if (plan.remote) {
    throw new Error(`Cannot modify remote plan '${planId}'. Write operations are local only.`);
  }

  // Validate all file names upfront
  for (const w of writes) {
    if (!FILE_NAME_MAP[w.file]) {
      throw new Error(`Invalid file "${w.file}". Must be one of: ${Object.keys(FILE_NAME_MAP).join(', ')}`);
    }
  }

  // Group by file
  const byFile = new Map<string, Array<{ section: string; content: string }>>();
  for (const w of writes) {
    const arr = byFile.get(w.file) ?? [];
    arr.push({ section: w.section, content: w.content });
    byFile.set(w.file, arr);
  }

  const planDir = dirname(plan.filePath);

  for (const [file, sections] of byFile) {
    const fileName = FILE_NAME_MAP[file];
    const filePath = join(planDir, fileName);

    if (fileName === PlanFile.README) {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = matter(raw);
      let body = parsed.content;
      for (const { section, content } of sections) {
        body = writeSection(body, section, content);
      }
      writeFileSync(filePath, matter.stringify(body, parsed.data));
    } else {
      let existing = '';
      if (existsSync(filePath)) {
        existing = readFileSync(filePath, 'utf8');
      } else {
        // Create the file (implementation, inputs, outputs)
        existing = '';
      }
      let content = existing;
      for (const { section, content: newContent } of sections) {
        content = writeSection(content, section, newContent);
      }
      writeFileSync(filePath, content);
    }
  }

  callbacks.refresh();
  return {
    id: planId,
    writes: writes.map(w => ({ file: w.file, section: w.section })),
  };
}

export function computeReadSection(options: ComputeReadSectionOptions): ReadSectionResult {
  const { planId, file, section, graph } = options;

  const plan = graph.plans.get(planId);
  if (!plan) throw new Error(`Plan "${planId}" not found.`);

  // Remote plans don't have local files — return body content only
  if (plan.remote) {
    if (!file && !section) {
      return { id: planId, content: plan.body };
    }
    throw new Error(`Cannot read files from remote plan '${planId}'. Only body content is available.`);
  }

  if (!file) {
    // Return all plan files concatenated
    const planDir = dirname(plan.filePath);
    let result = '';
    for (const [name, fileName] of Object.entries(FILE_NAME_MAP)) {
      const filePath = join(planDir, fileName);
      if (existsSync(filePath)) {
        let content = readFileSync(filePath, 'utf8');
        // Strip frontmatter from README
        if (fileName === PlanFile.README) {
          const parsed = parseFrontmatter(content);
          if (parsed) content = parsed.body;
        }
        if (result) result += '\n---\n\n';
        result += `# ${name}\n\n${content}`;
      }
    }
    return { id: planId, content: result };
  }

  const fileName = FILE_NAME_MAP[file];
  if (!fileName) throw new Error(`Invalid file "${file}". Must be one of: ${Object.keys(FILE_NAME_MAP).join(', ')}`);

  const planDir = dirname(plan.filePath);
  const filePath = join(planDir, fileName);

  if (!existsSync(filePath)) {
    throw new Error(`File ${fileName} does not exist for plan "${planId}".`);
  }

  let content = readFileSync(filePath, 'utf8');

  // For README, strip frontmatter for the body
  if (fileName === PlanFile.README) {
    const parsed = parseFrontmatter(content);
    if (parsed) content = parsed.body;
  }

  if (!section) {
    return { id: planId, file, content };
  }

  const sectionContent = readSection(content, section);
  if (sectionContent === null) {
    throw new Error(`Section "${section}" not found in ${fileName} for plan "${planId}".`);
  }

  return { id: planId, file, section, content: sectionContent };
}
