import { describe, it, expect } from 'vitest';

describe('library exports', () => {
  it('exports core types', async () => {
    const lib = await import('../index.ts');
    // Types are compile-time only, but type-narrowing constants should be present
    expect(lib.VALID_STATUSES).toEqual(['draft', 'not_started', 'in_progress', 'done', 'archived']);
  });

  it('exports scanner functions', async () => {
    const lib = await import('../index.ts');
    expect(typeof lib.scanPlans).toBe('function');
    expect(typeof lib.loadConfig).toBe('function');
    expect(typeof lib.derivePlanId).toBe('function');
  });

  it('exports graph functions', async () => {
    const lib = await import('../index.ts');
    expect(typeof lib.buildGraph).toBe('function');
    expect(typeof lib.detectCycles).toBe('function');
    expect(typeof lib.topologicalSort).toBe('function');
    expect(typeof lib.transitiveDependents).toBe('function');
    expect(typeof lib.computeCriticalPath).toBe('function');
    expect(typeof lib.pickNext).toBe('function');
    expect(typeof lib.computeChunks).toBe('function');
    expect(typeof lib.newlyReady).toBe('function');
  });

  it('exports frontmatter functions', async () => {
    const lib = await import('../index.ts');
    expect(typeof lib.parseFrontmatter).toBe('function');
    expect(typeof lib.validateFrontmatter).toBe('function');
    expect(typeof lib.readPlanFile).toBe('function');
    expect(typeof lib.updatePlanFile).toBe('function');
  });

  it('exports contract functions', async () => {
    const lib = await import('../index.ts');
    expect(typeof lib.parseInputs).toBe('function');
    expect(typeof lib.parseOutputs).toBe('function');
  });

  it('exports utility functions', async () => {
    const lib = await import('../index.ts');
    expect(typeof lib.filterPlans).toBe('function');
  });

  it('exports context functions', async () => {
    const lib = await import('../index.ts');
    expect(typeof lib.createContext).toBe('function');
    expect(typeof lib.refreshContext).toBe('function');
  });

  it('exports schema functions', async () => {
    const lib = await import('../index.ts');
    expect(typeof lib.detectSections).toBe('function');
    expect(typeof lib.readSection).toBe('function');
    expect(typeof lib.writeSection).toBe('function');
    expect(typeof lib.validateStatusGate).toBe('function');
  });

  it('exports manifest functions', async () => {
    const lib = await import('../index.ts');
    expect(typeof lib.parseManifest).toBe('function');
    expect(typeof lib.discoverManifest).toBe('function');
    expect(typeof lib.fetchRepoPlans).toBe('function');
    expect(typeof lib.fetchProjectPlans).toBe('function');
  });

  it('exports createContext and compute functions', async () => {
    const lib = await import('../index.ts');
    expect(typeof lib.createContext).toBe('function');
  });
});
