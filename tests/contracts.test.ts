import { describe, it, expect } from 'vitest';
import { parseOutputs, parseInputs } from '../src/contracts.ts';

describe('parseOutputs', () => {
  it('parses H2 headings as deliverables with bullet items', () => {
    const md = `# Outputs

## @acorn/core package
- Exports: Person, Family, Tree
- All types are pure data

## TreeStore interface
- get(id): Promise<Entity | null>
- put(entity): Promise<void>
`;
    const result = parseOutputs(md);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].heading).toBe('@acorn/core package');
    expect(result.sections[0].items).toEqual([
      'Exports: Person, Family, Tree',
      'All types are pure data',
    ]);
    expect(result.sections[1].heading).toBe('TreeStore interface');
    expect(result.sections[1].items).toEqual([
      'get(id): Promise<Entity | null>',
      'put(entity): Promise<void>',
    ]);
  });

  it('stores raw markdown', () => {
    const md = `## Something\n- item\n`;
    const result = parseOutputs(md);
    expect(result.raw).toBe(md);
  });

  it('returns empty sections for empty file', () => {
    const result = parseOutputs('');
    expect(result.sections).toEqual([]);
    expect(result.fromPlans).toEqual([]);
    expect(result.fromCode).toEqual([]);
  });

  it('returns empty sections when no H2 headings', () => {
    const result = parseOutputs('# Just a title\nSome text\n');
    expect(result.sections).toEqual([]);
  });

  it('handles H2 headings with no bullets', () => {
    const md = `## Empty section\n\n## Has items\n- one\n`;
    const result = parseOutputs(md);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].heading).toBe('Empty section');
    expect(result.sections[0].items).toEqual([]);
    expect(result.sections[1].items).toEqual(['one']);
  });

  it('outputs always have empty fromPlans and fromCode', () => {
    const md = `## Deliverable\n- item\n`;
    const result = parseOutputs(md);
    expect(result.fromPlans).toEqual([]);
    expect(result.fromCode).toEqual([]);
  });
});

describe('parseInputs', () => {
  it('parses "From plans" sections with H3 plan IDs', () => {
    const md = `# Inputs

## From plans

### contracts/core
- Plan type definitions
- ContractSection interface

### contracts/auth
- Auth token type

## From existing code

### src/scanner.ts
- Current plan discovery logic
`;
    const result = parseInputs(md);
    expect(result.fromPlans).toEqual(['contracts/core', 'contracts/auth']);
    expect(result.fromCode).toEqual(['src/scanner.ts']);

    // Check sections
    const planSections = result.sections.filter(s => s.source && !s.source.startsWith('src/'));
    expect(planSections).toHaveLength(2);
    expect(planSections[0].heading).toBe('contracts/core');
    expect(planSections[0].source).toBe('contracts/core');
    expect(planSections[0].items).toEqual([
      'Plan type definitions',
      'ContractSection interface',
    ]);

    const codeSections = result.sections.filter(s => s.source?.startsWith('src/'));
    expect(codeSections).toHaveLength(1);
    expect(codeSections[0].heading).toBe('src/scanner.ts');
    expect(codeSections[0].source).toBe('src/scanner.ts');
  });

  it('returns empty for empty file', () => {
    const result = parseInputs('');
    expect(result.sections).toEqual([]);
    expect(result.fromPlans).toEqual([]);
    expect(result.fromCode).toEqual([]);
  });

  it('handles missing "From plans" section', () => {
    const md = `# Inputs\n\n## From existing code\n\n### src/types.ts\n- Types\n`;
    const result = parseInputs(md);
    expect(result.fromPlans).toEqual([]);
    expect(result.fromCode).toEqual(['src/types.ts']);
  });

  it('handles missing "From existing code" section', () => {
    const md = `# Inputs\n\n## From plans\n\n### core/types\n- Types\n`;
    const result = parseInputs(md);
    expect(result.fromPlans).toEqual(['core/types']);
    expect(result.fromCode).toEqual([]);
  });

  it('stores raw markdown', () => {
    const md = `## From plans\n\n### plan-a\n- item\n`;
    const result = parseInputs(md);
    expect(result.raw).toBe(md);
  });

  it('handles H3 headings with no bullets', () => {
    const md = `## From plans\n\n### empty-plan\n\n### has-items\n- one\n`;
    const result = parseInputs(md);
    expect(result.fromPlans).toEqual(['empty-plan', 'has-items']);
    const emptySection = result.sections.find(s => s.heading === 'empty-plan');
    expect(emptySection!.items).toEqual([]);
  });

  it('handles only a title with no sections', () => {
    const md = `# Inputs\n\nSome description text.\n`;
    const result = parseInputs(md);
    expect(result.sections).toEqual([]);
    expect(result.fromPlans).toEqual([]);
    expect(result.fromCode).toEqual([]);
  });
});
