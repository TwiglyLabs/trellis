import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chunksCommand } from '../../src/commands/chunks.ts';
import { createFixture } from '../helpers.ts';

describe('chunks command', () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const origCwd = process.cwd;

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
  });

  afterEach(() => {
    process.cwd = origCwd;
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('shows message when no plans found', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    chunksCommand({});

    expect(logs.join('\n')).toContain('No plans found.');
  });

  it('shows empty JSON when no plans found', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    chunksCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.chunks).toEqual([]);
    expect(parsed.crossChunkEdges).toEqual([]);
  });

  it('groups a single plan into one chunk', () => {
    const { root } = createFixture([
      { id: 'standalone', title: 'Standalone', status: 'not_started' },
    ]);
    process.cwd = () => root;

    chunksCommand({});

    const output = logs.join('\n');
    expect(output).toContain('1 discovered');
    expect(output).toContain('standalone');
  });

  it('groups plans by directory', () => {
    const { root } = createFixture([
      { id: 'contracts/core', title: 'Core', status: 'not_started' },
      { id: 'contracts/auth', title: 'Auth', status: 'not_started' },
      { id: 'impl/parser', title: 'Parser', status: 'not_started' },
    ]);
    process.cwd = () => root;

    chunksCommand({});

    const output = logs.join('\n');
    expect(output).toContain('contracts');
    expect(output).toContain('impl');
  });

  it('outputs valid JSON matching schema', () => {
    const { root } = createFixture([
      { id: 'contracts/core', title: 'Core', status: 'not_started' },
      { id: 'contracts/auth', title: 'Auth', status: 'not_started', depends_on: ['contracts/core'] },
    ]);
    process.cwd = () => root;

    chunksCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.chunks).toHaveLength(1);
    expect(parsed.chunks[0].id).toBe('contracts');
    expect(parsed.chunks[0].planCount).toBe(2);
    expect(parsed.chunks[0].plans[0]).toHaveProperty('id');
    expect(parsed.chunks[0].plans[0]).toHaveProperty('filePath');
    expect(parsed.chunks[0].plans[0]).toHaveProperty('lines');
    expect(parsed.chunks[0]).toHaveProperty('roots');
    expect(parsed.chunks[0]).toHaveProperty('leaves');
    expect(parsed.chunks[0]).toHaveProperty('internalEdges');
    expect(parsed.config).toHaveProperty('maxLines');
    expect(parsed.config).toHaveProperty('overrides');
  });

  it('shows cross-chunk edges with --verbose', () => {
    const { root } = createFixture([
      { id: 'contracts/core', title: 'Core', status: 'not_started' },
      { id: 'impl/parser', title: 'Parser', status: 'not_started', depends_on: ['contracts/core'] },
    ]);
    process.cwd = () => root;

    chunksCommand({ verbose: true });

    const output = logs.join('\n');
    expect(output).toContain('Cross-chunk edges');
    expect(output).toContain('contracts/core');
  });

  it('does not show cross-chunk edges without --verbose', () => {
    const { root } = createFixture([
      { id: 'contracts/core', title: 'Core', status: 'not_started' },
      { id: 'impl/parser', title: 'Parser', status: 'not_started', depends_on: ['contracts/core'] },
    ]);
    process.cwd = () => root;

    chunksCommand({});

    const output = logs.join('\n');
    expect(output).not.toContain('Cross-chunk edges');
  });

  it('places chunk:name override plan in named chunk', () => {
    const { root } = createFixture([
      { id: 'contracts/core', title: 'Core', status: 'not_started', tags: ['chunk:special'] },
      { id: 'contracts/auth', title: 'Auth', status: 'not_started' },
      { id: 'impl/parser', title: 'Parser', status: 'not_started' },
    ]);
    process.cwd = () => root;

    chunksCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    const special = parsed.chunks.find((c: any) => c.id === 'special');
    expect(special).toBeDefined();
    expect(special.plans.some((p: any) => p.id === 'contracts/core')).toBe(true);
  });

  it('warns on stderr for over-budget chunks', () => {
    // Create a plan with large body that exceeds a tight budget
    const { root } = createFixture([
      { id: 'big', title: 'Big Plan', status: 'not_started', body: 'x\n'.repeat(100) },
    ]);
    // Write a config with tiny chunk_max_lines
    const { writeFileSync } = require('fs');
    const { join } = require('path');
    writeFileSync(join(root, '.trellis'), 'project: test\nplans_dir: plans\nchunk_max_lines: 10\n');
    process.cwd = () => root;

    chunksCommand({});

    expect(errors.some(e => e.includes('exceeds line budget'))).toBe(true);
  });

  it('keeps unconnected directories separate', () => {
    const { root } = createFixture([
      { id: 'contracts/core', title: 'Core', status: 'not_started' },
      { id: 'impl/parser', title: 'Parser', status: 'not_started' },
    ]);
    process.cwd = () => root;

    chunksCommand({ json: true });

    const parsed = JSON.parse(logs.join(''));
    expect(parsed.chunks).toHaveLength(2);
  });

  it('accepts --strategy CLI override', () => {
    const { root } = createFixture([
      { id: 'impl/core', title: 'Core', status: 'not_started' },
      { id: 'impl/auth', title: 'Auth', status: 'not_started' },
      { id: 'impl/parser', title: 'Parser', status: 'not_started', depends_on: ['impl/core'] },
    ]);
    process.cwd = () => root;

    // Verify the command accepts the strategy option without errors
    chunksCommand({ json: true, strategy: 'directory' });
    const dirResult = JSON.parse(logs.join(''));
    expect(dirResult.chunks).toHaveLength(1);
    expect(dirResult.chunks[0].id).toBe('impl');

    logs.length = 0;

    // Verify topological strategy is accepted (implementation pending)
    chunksCommand({ json: true, strategy: 'topological' });
    const topoResult = JSON.parse(logs.join(''));
    // For now, both strategies may produce same result until topological is implemented
    expect(topoResult.chunks.length).toBeGreaterThanOrEqual(1);
  });
});
