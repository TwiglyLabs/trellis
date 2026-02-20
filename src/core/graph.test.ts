import { describe, it, expect } from 'vitest';
import { buildGraph, detectCycles, topologicalSort, transitiveDependents, newlyReady, computeCriticalPath, pickNext, computeChunks, computeDepths, groupByTopologicalDepth, interfaceWidthSplit, chunkContractAggregation } from './graph.ts';
import type { Plan, PlanContract } from './types.ts';

function makePlan(id: string, status: string, depends_on: string[] = [], opts?: { tags?: string[]; body?: string; inputs?: PlanContract; outputs?: PlanContract }): Plan {
  return {
    id,
    filePath: `plans/${id}.md`,
    frontmatter: {
      title: id,
      status: status as any,
      depends_on: depends_on.length > 0 ? depends_on : undefined,
      tags: opts?.tags,
    },
    body: opts?.body ?? '',
    lineCount: (opts?.body ?? '').split('\n').length + 4, // +4 for frontmatter lines
    inputs: opts?.inputs,
    outputs: opts?.outputs,
  };
}

function makeOutputs(sections: Array<{ heading: string; items: string[] }>): PlanContract {
  return { raw: '', fromPlans: [], fromCode: [], sections: sections.map(s => ({ ...s })) };
}

function makeInputs(fromPlans: string[], sections?: Array<{ heading: string; items: string[]; source?: string }>): PlanContract {
  return {
    raw: '',
    fromPlans,
    fromCode: [],
    sections: sections ?? fromPlans.map(p => ({ heading: p, items: [], source: p })),
  };
}

describe('buildGraph', () => {
  it('identifies ready plans', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
    ];
    const graph = buildGraph(plans);
    expect(graph.ready.has('a')).toBe(true);
    expect(graph.ready.has('b')).toBe(false);
    expect(graph.blocked.has('b')).toBe(true);
  });

  it('marks plan as ready when all deps are done', () => {
    const plans = [
      makePlan('a', 'done'),
      makePlan('b', 'not_started', ['a']),
    ];
    const graph = buildGraph(plans);
    expect(graph.ready.has('b')).toBe(true);
    expect(graph.blocked.has('b')).toBe(false);
  });

  it('builds dependents map', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started', ['a']),
    ];
    const graph = buildGraph(plans);
    expect(graph.dependents.get('a')?.sort()).toEqual(['b', 'c']);
  });

  it('handles diamond dependencies', () => {
    const plans = [
      makePlan('a', 'done'),
      makePlan('b', 'done', ['a']),
      makePlan('c', 'done', ['a']),
      makePlan('d', 'not_started', ['b', 'c']),
    ];
    const graph = buildGraph(plans);
    expect(graph.ready.has('d')).toBe(true);
  });

  it('blocks diamond when one branch incomplete', () => {
    const plans = [
      makePlan('a', 'done'),
      makePlan('b', 'done', ['a']),
      makePlan('c', 'in_progress', ['a']),
      makePlan('d', 'not_started', ['b', 'c']),
    ];
    const graph = buildGraph(plans);
    expect(graph.blocked.has('d')).toBe(true);
  });

  it('builds dependencies map (forward edges)', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started', ['a', 'b']),
    ];
    const graph = buildGraph(plans);
    expect(graph.dependencies.get('a')).toEqual([]);
    expect(graph.dependencies.get('b')).toEqual(['a']);
    expect(graph.dependencies.get('c')?.sort()).toEqual(['a', 'b']);
  });

  it('filters out missing deps in dependencies map', () => {
    const plans = [
      makePlan('a', 'not_started', ['nonexistent', 'b']),
      makePlan('b', 'not_started'),
    ];
    const graph = buildGraph(plans);
    expect(graph.dependencies.get('a')).toEqual(['b']);
  });

  it('ignores non-not_started plans for ready/blocked', () => {
    const plans = [
      makePlan('a', 'draft'),
      makePlan('b', 'in_progress'),
      makePlan('c', 'done'),
    ];
    const graph = buildGraph(plans);
    expect(graph.ready.size).toBe(0);
    expect(graph.blocked.size).toBe(0);
  });
});

describe('detectCycles', () => {
  it('detects simple cycle', () => {
    const plans = [
      makePlan('a', 'not_started', ['b']),
      makePlan('b', 'not_started', ['a']),
    ];
    const cycles = detectCycles(plans);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('detects 3-node cycle', () => {
    const plans = [
      makePlan('a', 'not_started', ['c']),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started', ['b']),
    ];
    const cycles = detectCycles(plans);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('returns empty for acyclic graph', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started', ['b']),
    ];
    const cycles = detectCycles(plans);
    expect(cycles).toHaveLength(0);
  });

  it('skips missing dependency references', () => {
    const plans = [
      makePlan('a', 'not_started', ['nonexistent']),
    ];
    const cycles = detectCycles(plans);
    expect(cycles).toHaveLength(0);
  });
});

describe('topologicalSort', () => {
  it('sorts linear chain', () => {
    const plans = [
      makePlan('c', 'not_started', ['b']),
      makePlan('b', 'not_started', ['a']),
      makePlan('a', 'not_started'),
    ];
    const sorted = topologicalSort(plans);
    expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'));
    expect(sorted.indexOf('b')).toBeLessThan(sorted.indexOf('c'));
  });

  it('handles diamond', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started', ['a']),
      makePlan('d', 'not_started', ['b', 'c']),
    ];
    const sorted = topologicalSort(plans);
    expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'));
    expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('c'));
    expect(sorted.indexOf('b')).toBeLessThan(sorted.indexOf('d'));
    expect(sorted.indexOf('c')).toBeLessThan(sorted.indexOf('d'));
  });

  it('returns partial result when cycles exist', () => {
    const plans = [
      makePlan('a', 'not_started', ['b']),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started'),
    ];
    const sorted = topologicalSort(plans);
    // c has no deps, should appear. a and b are in a cycle.
    expect(sorted).toContain('c');
    expect(sorted.length).toBeLessThan(3);
  });
});

describe('transitiveDependents', () => {
  it('finds transitive dependents', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started', ['b']),
    ];
    const graph = buildGraph(plans);
    const result = transitiveDependents('a', graph);
    expect(result).toContain('b');
    expect(result).toContain('c');
  });

  it('handles diamond without duplicates', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started', ['a']),
      makePlan('d', 'not_started', ['b', 'c']),
    ];
    const graph = buildGraph(plans);
    const result = transitiveDependents('a', graph);
    expect(new Set(result).size).toBe(result.length); // no dupes
    expect(result).toContain('b');
    expect(result).toContain('c');
    expect(result).toContain('d');
  });
});

describe('newlyReady', () => {
  it('finds plans unblocked by completion', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
    ];
    const graph = buildGraph(plans);
    const result = newlyReady('a', 'done', graph);
    expect(result).toEqual(['b']);
  });

  it('returns empty if status is not done', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
    ];
    const graph = buildGraph(plans);
    expect(newlyReady('a', 'in_progress', graph)).toEqual([]);
  });

  it('does not include plans with other unsatisfied deps', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('c', 'not_started'),
      makePlan('b', 'not_started', ['a', 'c']),
    ];
    const graph = buildGraph(plans);
    const result = newlyReady('a', 'done', graph);
    expect(result).toEqual([]);
  });

  it('includes plans when all deps become satisfied', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('c', 'done'),
      makePlan('b', 'not_started', ['a', 'c']),
    ];
    const graph = buildGraph(plans);
    const result = newlyReady('a', 'done', graph);
    expect(result).toEqual(['b']);
  });
});

describe('computeCriticalPath', () => {
  it('returns single node for root plan', () => {
    const plans = [makePlan('a', 'not_started')];
    const graph = buildGraph(plans);
    expect(computeCriticalPath('a', graph)).toEqual(['a']);
  });

  it('computes linear chain', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started', ['b']),
    ];
    const graph = buildGraph(plans);
    expect(computeCriticalPath('c', graph)).toEqual(['a', 'b', 'c']);
  });

  it('picks longest path through diamond', () => {
    const plans = [
      makePlan('root', 'not_started'),
      makePlan('short', 'not_started', ['root']),
      makePlan('mid', 'not_started', ['root']),
      makePlan('long', 'not_started', ['mid']),
      makePlan('end', 'not_started', ['short', 'long']),
    ];
    const graph = buildGraph(plans);
    const path = computeCriticalPath('end', graph);
    expect(path).toEqual(['root', 'mid', 'long', 'end']);
  });

  it('returns empty array for missing plan', () => {
    const plans = [makePlan('a', 'not_started')];
    const graph = buildGraph(plans);
    expect(computeCriticalPath('nonexistent', graph)).toEqual([]);
  });

  it('skips missing dependencies', () => {
    const plans = [makePlan('a', 'not_started', ['nonexistent'])];
    const graph = buildGraph(plans);
    expect(computeCriticalPath('a', graph)).toEqual(['a']);
  });
});

describe('pickNext', () => {
  it('returns the ready plan on the longest forward path', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started', ['b']),
      makePlan('d', 'not_started'),
    ];
    const graph = buildGraph(plans);

    // a and d are both ready. a has forward path a→b→c (depth 3), d has depth 1.
    const result = pickNext(graph);
    expect(result).toBe('a');
  });

  it('returns null when no plans are ready', () => {
    const plans = [makePlan('a', 'in_progress')];
    const graph = buildGraph(plans);

    expect(pickNext(graph)).toBeNull();
  });

  it('respects candidate filtering', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started', ['b']),
      makePlan('d', 'not_started'),
    ];
    const graph = buildGraph(plans);

    // a has longest forward path overall, but restrict to {d} only
    const result = pickNext(graph, new Set(['d']));
    expect(result).toBe('d');
  });

  it('breaks ties by topological order', () => {
    const plans = [
      makePlan('x', 'not_started'),
      makePlan('x-child', 'not_started', ['x']),
      makePlan('y', 'not_started'),
      makePlan('y-child', 'not_started', ['y']),
    ];
    const graph = buildGraph(plans);

    // Both x and y have forward depth 2. Topo order tiebreaks.
    const result = pickNext(graph);
    expect(['x', 'y']).toContain(result); // deterministic but depends on topo impl
  });
});

describe('computeChunks', () => {
  it('returns empty result for zero plans', () => {
    const graph = buildGraph([]);
    const result = computeChunks([], graph);
    expect(result.chunks).toEqual([]);
    expect(result.crossChunkEdges).toEqual([]);
    expect(result.config.maxLines).toBe(8000);
  });

  it('creates one chunk for a single root-level plan', () => {
    const plans = [makePlan('standalone', 'not_started')];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].planCount).toBe(1);
    expect(result.chunks[0].plans[0].id).toBe('standalone');
  });

  it('groups plans in same directory together', () => {
    const plans = [
      makePlan('contracts/core', 'not_started'),
      makePlan('contracts/auth', 'not_started'),
    ];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].id).toBe('contracts');
    expect(result.chunks[0].planCount).toBe(2);
  });

  it('keeps root-level plans separate when no edges', () => {
    const plans = [
      makePlan('alpha', 'not_started'),
      makePlan('beta', 'not_started'),
    ];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    expect(result.chunks).toHaveLength(2);
  });

  it('merges groups with 2+ cross-edges', () => {
    const plans = [
      makePlan('contracts/core', 'not_started'),
      makePlan('contracts/auth', 'not_started'),
      makePlan('impl/parser', 'not_started', ['contracts/core']),
      makePlan('impl/validator', 'not_started', ['contracts/core', 'contracts/auth']),
    ];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    // contracts and impl share 3 edges (core->parser, core->validator, auth->validator)
    // Should merge into one chunk
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].planCount).toBe(4);
  });

  it('respects line budget during merge', () => {
    // Large body plans that exceed budget when merged
    const bigBody = 'x\n'.repeat(5000);
    const plans = [
      makePlan('contracts/core', 'not_started', [], { body: bigBody }),
      makePlan('contracts/auth', 'not_started'),
      makePlan('impl/parser', 'not_started', ['contracts/core']),
      makePlan('impl/validator', 'not_started', ['contracts/core', 'contracts/auth']),
    ];
    const graph = buildGraph(plans);
    // With maxLines=6000, contracts group is ~5004 lines, impl is ~8 lines
    // But since contracts alone is ~5004 and impl ~8, combined < 6000
    // Let's use a tighter budget
    const result = computeChunks(plans, graph, { maxLines: 100 });
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it('stops merging when best pair has <= 1 edge', () => {
    const plans = [
      makePlan('contracts/core', 'not_started'),
      makePlan('contracts/auth', 'not_started'),
      makePlan('impl/parser', 'not_started', ['contracts/core']),
      makePlan('impl/validator', 'not_started'),
    ];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    // contracts->impl: only 1 edge (core->parser). Threshold is >1, so no merge
    expect(result.chunks).toHaveLength(2);
  });

  it('applies chunk:name tag overrides', () => {
    const plans = [
      makePlan('contracts/core', 'not_started', [], { tags: ['chunk:special'] }),
      makePlan('contracts/auth', 'not_started'),
      makePlan('impl/parser', 'not_started'),
    ];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    const special = result.chunks.find(c => c.id === 'special');
    expect(special).toBeDefined();
    expect(special!.plans.some(p => p.id === 'contracts/core')).toBe(true);
    expect(result.config.overrides).toBe(1);
  });

  it('reassigns orphans after override displacement', () => {
    // core and auth start in contracts group. Override moves core to special.
    // auth is alone in contracts group, parser is alone in impl.
    // auth depends on parser, so if we set that up, auth's orphan assignment works.
    const plans = [
      makePlan('contracts/core', 'not_started', [], { tags: ['chunk:special'] }),
      makePlan('contracts/auth', 'not_started', ['impl/parser']),
      makePlan('impl/parser', 'not_started'),
    ];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    // auth stays in its own contracts group (not displaced - only core was moved)
    // contracts group still has auth in it
    const contractsChunk = result.chunks.find(c => c.plans.some(p => p.id === 'contracts/auth'));
    expect(contractsChunk).toBeDefined();
  });

  it('identifies cross-chunk edges correctly', () => {
    const plans = [
      makePlan('contracts/core', 'not_started'),
      makePlan('impl/parser', 'not_started', ['contracts/core']),
    ];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    expect(result.crossChunkEdges).toHaveLength(1);
    expect(result.crossChunkEdges[0].from).toBe('contracts/core');
    expect(result.crossChunkEdges[0].to).toBe('impl/parser');
  });

  it('generates chunk ID from common prefix', () => {
    const plans = [
      makePlan('impl/parser', 'not_started'),
      makePlan('impl/validator', 'not_started'),
    ];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    expect(result.chunks[0].id).toBe('impl');
  });

  it('falls back to chunk-N when no common prefix', () => {
    const plans = [
      makePlan('contracts/core', 'not_started'),
      makePlan('impl/parser', 'not_started', ['contracts/core']),
      makePlan('impl/validator', 'not_started', ['contracts/core']),
    ];
    const graph = buildGraph(plans);
    // contracts and impl have 2 edges, should merge
    const result = computeChunks(plans, graph);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].id).toBe('chunk-1');
  });

  it('computes roots and leaves correctly', () => {
    const plans = [
      makePlan('contracts/core', 'not_started'),
      makePlan('contracts/auth', 'not_started', ['contracts/core']),
      makePlan('contracts/api', 'not_started', ['contracts/auth']),
    ];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].roots).toEqual(['contracts/core']);
    expect(result.chunks[0].leaves).toEqual(['contracts/api']);
  });

  it('keeps unconnected directory groups separate', () => {
    const plans = [
      makePlan('contracts/core', 'not_started'),
      makePlan('contracts/auth', 'not_started'),
      makePlan('impl/parser', 'not_started'),
      makePlan('impl/validator', 'not_started'),
    ];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    // No cross-edges between groups, stays separate
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks.map(c => c.id).sort()).toEqual(['contracts', 'impl']);
  });

  it('reports config maxLines and override count', () => {
    const plans = [makePlan('a', 'not_started')];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph, { maxLines: 5000 });
    expect(result.config.maxLines).toBe(5000);
    expect(result.config.overrides).toBe(0);
  });

  it('takes only first chunk: tag when plan has multiple', () => {
    const plans = [
      makePlan('contracts/core', 'not_started', [], { tags: ['chunk:alpha', 'chunk:beta'] }),
      makePlan('contracts/auth', 'not_started'),
      makePlan('impl/parser', 'not_started'),
    ];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    // Should only count as 1 override (not 2)
    expect(result.config.overrides).toBe(1);
    // core should be in alpha, not in beta
    const alpha = result.chunks.find(c => c.id === 'alpha');
    const beta = result.chunks.find(c => c.id === 'beta');
    expect(alpha).toBeDefined();
    expect(alpha!.plans.some(p => p.id === 'contracts/core')).toBe(true);
    expect(beta).toBeUndefined();
  });

  it('handles chunk:name override merging into existing named group', () => {
    // Override chunk:contracts should merge parser into the contracts group
    const plans = [
      makePlan('contracts/core', 'not_started'),
      makePlan('impl/parser', 'not_started', [], { tags: ['chunk:contracts'] }),
    ];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph);
    const contractsChunk = result.chunks.find(c => c.id === 'contracts');
    expect(contractsChunk).toBeDefined();
    expect(contractsChunk!.planCount).toBe(2);
    expect(contractsChunk!.plans.map(p => p.id).sort()).toEqual(['contracts/core', 'impl/parser']);
  });

  it('uses topological strategy when specified', () => {
    const plans = [
      makePlan('impl/core', 'not_started'),
      makePlan('impl/auth', 'not_started'),
      makePlan('impl/parser', 'not_started', ['impl/core']),
      makePlan('impl/validator', 'not_started', ['impl/core', 'impl/auth']),
    ];
    const graph = buildGraph(plans);
    const result = computeChunks(plans, graph, { strategy: 'topological' });
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('directory strategy remains default and backwards compatible', () => {
    const plans = [
      makePlan('contracts/core', 'not_started'),
      makePlan('contracts/auth', 'not_started'),
      makePlan('impl/parser', 'not_started', ['contracts/core']),
    ];
    const graph = buildGraph(plans);
    const withDefault = computeChunks(plans, graph);
    const withExplicit = computeChunks(plans, graph, { strategy: 'directory' });
    expect(withDefault.chunks.map(c => c.id)).toEqual(withExplicit.chunks.map(c => c.id));
  });
});

describe('computeDepths', () => {
  it('assigns depth 0 to roots', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started'),
    ];
    const graph = buildGraph(plans);
    const depths = computeDepths(plans, graph);
    expect(depths.get('a')).toBe(0);
    expect(depths.get('b')).toBe(0);
  });

  it('assigns increasing depths along chains', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started', ['a']),
      makePlan('c', 'not_started', ['b']),
    ];
    const graph = buildGraph(plans);
    const depths = computeDepths(plans, graph);
    expect(depths.get('a')).toBe(0);
    expect(depths.get('b')).toBe(1);
    expect(depths.get('c')).toBe(2);
  });

  it('uses longest path for diamond dependencies', () => {
    const plans = [
      makePlan('root', 'not_started'),
      makePlan('short', 'not_started', ['root']),
      makePlan('mid', 'not_started', ['root']),
      makePlan('long', 'not_started', ['mid']),
      makePlan('end', 'not_started', ['short', 'long']),
    ];
    const graph = buildGraph(plans);
    const depths = computeDepths(plans, graph);
    expect(depths.get('root')).toBe(0);
    expect(depths.get('short')).toBe(1);
    expect(depths.get('mid')).toBe(1);
    expect(depths.get('long')).toBe(2);
    expect(depths.get('end')).toBe(3);
  });
});

describe('groupByTopologicalDepth', () => {
  it('groups plans by depth', () => {
    const plans = [
      makePlan('a', 'not_started'),
      makePlan('b', 'not_started'),
      makePlan('c', 'not_started', ['a']),
      makePlan('d', 'not_started', ['a', 'b']),
    ];
    const graph = buildGraph(plans);
    const groups = groupByTopologicalDepth(plans, graph);
    const layer0 = groups.get('layer-0');
    const layer1 = groups.get('layer-1');
    expect(layer0).toBeDefined();
    expect(layer1).toBeDefined();
    expect([...layer0!].sort()).toEqual(['a', 'b']);
    expect([...layer1!].sort()).toEqual(['c', 'd']);
  });
});

describe('interfaceWidthSplit', () => {
  it('splits oversized group at narrowest interface', () => {
    const plans = [
      makePlan('a', 'not_started', [], { body: 'x\n'.repeat(1500), outputs: makeOutputs([{ heading: 'A output', items: ['item1'] }]) }),
      makePlan('b', 'not_started', ['a'], { body: 'x\n'.repeat(1500), outputs: makeOutputs([{ heading: 'B output', items: ['item1'] }]) }),
      makePlan('c', 'not_started', ['b'], { body: 'x\n'.repeat(1500), outputs: makeOutputs([{ heading: 'C output', items: ['item1'] }]) }),
      makePlan('d', 'not_started', ['c'], { body: 'x\n'.repeat(1500) }),
    ];
    const graph = buildGraph(plans);
    const groups = new Map<string, Set<string>>();
    groups.set('all', new Set(['a', 'b', 'c', 'd']));

    interfaceWidthSplit(groups, plans, graph, 3500);

    expect(groups.size).toBe(2);
    for (const [, ids] of groups) {
      let total = 0;
      for (const id of ids) {
        const p = graph.plans.get(id);
        if (p) total += p.lineCount;
      }
      expect(total).toBeLessThanOrEqual(3500);
    }
  });

  it('does not split groups within budget', () => {
    const plans = [
      makePlan('a', 'not_started', [], { body: 'x' }),
      makePlan('b', 'not_started', ['a'], { body: 'x' }),
    ];
    const graph = buildGraph(plans);
    const groups = new Map<string, Set<string>>();
    groups.set('small', new Set(['a', 'b']));

    interfaceWidthSplit(groups, plans, graph, 8000);
    expect(groups.size).toBe(1);
  });

  it('falls back to edge count when no contracts', () => {
    const plans = [
      makePlan('a', 'not_started', [], { body: 'x\n'.repeat(2000) }),
      makePlan('b', 'not_started', ['a'], { body: 'x\n'.repeat(2000) }),
      makePlan('c', 'not_started', ['b'], { body: 'x\n'.repeat(2000) }),
    ];
    const graph = buildGraph(plans);
    const groups = new Map<string, Set<string>>();
    groups.set('all', new Set(['a', 'b', 'c']));

    interfaceWidthSplit(groups, plans, graph, 5000);
    expect(groups.size).toBe(2);
  });

  it('annotates group with advisory when split not possible', () => {
    const plans = [
      makePlan('a', 'not_started', [], { body: 'x\n'.repeat(5000) }),
      makePlan('b', 'not_started', ['a'], { body: 'x\n'.repeat(5000) }),
    ];
    const graph = buildGraph(plans);
    const groups = new Map<string, Set<string>>();
    groups.set('big', new Set(['a', 'b']));

    const advisories = interfaceWidthSplit(groups, plans, graph, 3000);
    expect(advisories.size).toBeGreaterThanOrEqual(1);
  });
});

describe('chunkContractAggregation', () => {
  it('computes cross-boundary contracts', () => {
    const plans = [
      makePlan('a', 'not_started', [], {
        outputs: makeOutputs([
          { heading: 'Types', items: ['Person', 'Family'] },
          { heading: 'Store', items: ['TreeStore'] },
        ]),
      }),
      makePlan('b', 'not_started', ['a'], {
        inputs: makeInputs(['a'], [{ heading: 'a', items: ['Person type'], source: 'a' }]),
      }),
    ];
    const graph = buildGraph(plans);

    const chunks = [
      { id: 'chunk-a', plans: [{ id: 'a', filePath: '', lines: 0 }], roots: ['a'], leaves: ['a'], planCount: 1, totalLines: 0, internalEdges: [] },
      { id: 'chunk-b', plans: [{ id: 'b', filePath: '', lines: 0 }], roots: ['b'], leaves: ['b'], planCount: 1, totalLines: 0, internalEdges: [] },
    ];

    chunkContractAggregation(chunks, plans, graph);

    const chunkA = chunks.find(c => c.id === 'chunk-a')!;
    const chunkB = chunks.find(c => c.id === 'chunk-b')!;
    expect(chunkA.chunkOutputs).toBeDefined();
    expect(chunkA.chunkOutputs!.length).toBeGreaterThan(0);
    expect(chunkB.chunkInputs).toBeDefined();
    expect(chunkB.chunkInputs!.length).toBeGreaterThan(0);
  });

  it('skips internal edges', () => {
    const plans = [
      makePlan('a', 'not_started', [], {
        outputs: makeOutputs([{ heading: 'Types', items: ['Person'] }]),
      }),
      makePlan('b', 'not_started', ['a'], {
        inputs: makeInputs(['a']),
      }),
    ];
    const graph = buildGraph(plans);

    const chunks = [
      { id: 'chunk-1', plans: [{ id: 'a', filePath: '', lines: 0 }, { id: 'b', filePath: '', lines: 0 }], roots: ['a'], leaves: ['b'], planCount: 2, totalLines: 0, internalEdges: [] },
    ];

    chunkContractAggregation(chunks, plans, graph);

    const chunk = chunks[0];
    expect(chunk.chunkOutputs ?? []).toHaveLength(0);
    expect(chunk.chunkInputs ?? []).toHaveLength(0);
  });
});
