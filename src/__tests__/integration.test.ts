import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createFixture } from './helpers.ts';
import { statusCommand } from '../features/status/command.ts';
import { readyCommand } from '../features/ready/command.ts';
import { updateCommand } from '../features/update/command.ts';
import { showCommand } from '../features/show/command.ts';
import { lintCommand } from '../features/lint/command.ts';
import { initCommand } from '../features/init/command.ts';
import { chunksCommand } from '../features/chunks/command.ts';

describe('integration: full workflow', () => {
  let originalCwd: () => string;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    originalCwd = process.cwd;
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logs.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      errors.push(args.join(' '));
    });
  });

  afterEach(() => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('init creates config and plans dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-int-'));
    process.cwd = () => dir;

    await initCommand({ yes: true });

    expect(existsSync(join(dir, '.trellis'))).toBe(true);
    expect(existsSync(join(dir, 'plans'))).toBe(true);

    const config = readFileSync(join(dir, '.trellis'), 'utf8');
    expect(config).toContain('project:');
    expect(config).toContain('plans_dir: plans');
  });

  it('full lifecycle: create plans -> status -> ready -> update -> check unblocked', () => {
    // Create a realistic project with dependencies
    const { root, plansDir } = createFixture([
      { id: 'contracts/core-types', title: 'Core Types', status: 'done', tags: ['foundation'] },
      { id: 'contracts/auth', title: 'Auth Contract', status: 'done', tags: ['foundation'] },
      { id: 'impl/extraction', title: 'Core Extraction', status: 'not_started', depends_on: ['contracts/core-types'], tags: ['implementation'], repo: 'public' },
      { id: 'impl/schema-v6', title: 'Schema v6', status: 'not_started', depends_on: ['impl/extraction'], tags: ['implementation'], repo: 'public' },
      { id: 'impl/auth-service', title: 'Auth Service', status: 'not_started', depends_on: ['contracts/auth'], tags: ['implementation'], repo: 'cloud' },
      { id: 'impl/cloud-api', title: 'Cloud API', status: 'not_started', depends_on: ['impl/auth-service', 'impl/extraction'], tags: ['implementation'], repo: 'cloud' },
      { id: 'planning/roadmap', title: 'Roadmap', status: 'draft' },
    ]);
    process.cwd = () => root;

    // Status shows dashboard (done hidden by default)
    logs = [];
    statusCommand({});
    let output = logs.join('\n');
    expect(output).toContain('5 plans'); // 7 total minus 2 done
    expect(output).toContain('READY');
    expect(output).toContain('BLOCKED');
    expect(output).not.toContain('DONE');
    expect(output).toContain('DRAFT');

    // Ready shows plans with satisfied deps
    logs = [];
    readyCommand({});
    output = logs.join('\n');
    expect(output).toContain('impl/extraction');
    expect(output).toContain('impl/auth-service');
    expect(output).not.toContain('impl/schema-v6');
    expect(output).not.toContain('impl/cloud-api');

    // Ready with repo filter
    logs = [];
    readyCommand({ repo: 'cloud' });
    output = logs.join('\n');
    expect(output).toContain('impl/auth-service');
    expect(output).not.toContain('impl/extraction');

    // Show blocked plan details
    logs = [];
    showCommand('impl/cloud-api');
    output = logs.join('\n');
    expect(output).toContain('Cloud API');
    expect(output).toContain('blocked');
    expect(output).toContain('impl/auth-service');
    expect(output).toContain('impl/extraction');

    // Lint passes
    logs = [];
    lintCommand();
    output = logs.join('\n');
    expect(output).toContain('7 plans OK');

    // Update extraction to done
    logs = [];
    updateCommand('impl/extraction', 'done', { force: true });
    output = logs.join('\n');
    expect(output).toContain('impl/extraction → done');
    expect(output).toContain('Now ready');
    expect(output).toContain('impl/schema-v6');

    // Verify file was updated
    const extractionContent = readFileSync(join(plansDir, 'impl/extraction', 'README.md'), 'utf8');
    expect(extractionContent).toContain('status: done');
    expect(extractionContent).toContain('completed_at');

    // After update, schema-v6 should now be ready
    logs = [];
    readyCommand({});
    output = logs.join('\n');
    expect(output).toContain('impl/schema-v6');

    // cloud-api still blocked (needs auth-service too)
    logs = [];
    showCommand('impl/cloud-api');
    output = logs.join('\n');
    expect(output).toContain('blocked');

    // Complete auth-service
    logs = [];
    updateCommand('impl/auth-service', 'done', { force: true });
    output = logs.join('\n');
    expect(output).toContain('Now ready');
    expect(output).toContain('impl/cloud-api');

    // JSON output works (--all to see everything)
    logs = [];
    statusCommand({ json: true, all: true });
    const jsonOutput = JSON.parse(logs.join(''));
    expect(jsonOutput.project).toBe('test-project');
    expect(jsonOutput.plans.length).toBe(7);
  });

  it('lint detects issues', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started', depends_on: ['nonexistent'] },
      { id: 'b', title: 'Plan B', status: 'done', depends_on: ['a'] },
    ]);
    process.cwd = () => root;

    lintCommand();

    const output = logs.join('\n');
    expect(output).toContain('Unknown dependency');
    expect(output).toContain('b is done but depends on a');
    expect(process.exitCode).toBe(1);
  });

  it('handles missing plans directory gracefully', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-int-'));
    writeFileSync(join(dir, '.trellis'), 'project: test\nplans_dir: plans\n');
    process.cwd = () => dir;

    statusCommand({});

    expect(logs.join('\n')).toContain('No plans found');
  });

  it('handles update of nonexistent plan', () => {
    const { root } = createFixture([]);
    process.cwd = () => root;

    updateCommand('nonexistent', 'done');

    expect(errors.join('\n')).toContain('not found');
    expect(process.exitCode).toBe(1);
  });

  it('chunks discovers subgraphs from dependency structure', () => {
    const { root } = createFixture([
      { id: 'contracts/core-types', title: 'Core Types', status: 'done', tags: ['foundation'] },
      { id: 'contracts/auth', title: 'Auth Contract', status: 'done', tags: ['foundation'] },
      { id: 'impl/extraction', title: 'Core Extraction', status: 'not_started', depends_on: ['contracts/core-types'], tags: ['implementation'], repo: 'public' },
      { id: 'impl/schema-v6', title: 'Schema v6', status: 'not_started', depends_on: ['impl/extraction'], tags: ['implementation'], repo: 'public' },
      { id: 'impl/auth-service', title: 'Auth Service', status: 'not_started', depends_on: ['contracts/auth'], tags: ['implementation'], repo: 'cloud' },
    ]);
    process.cwd = () => root;

    // Human-readable output
    logs = [];
    chunksCommand({});
    const output = logs.join('\n');
    expect(output).toContain('Chunks');
    expect(output).toContain('contracts');
    expect(output).toContain('impl');

    // JSON output
    logs = [];
    chunksCommand({ json: true });
    const json = JSON.parse(logs.join(''));
    expect(json.chunks.length).toBeGreaterThanOrEqual(1);
    expect(json.config.maxLines).toBe(8000);
    const allPlanIds = json.chunks.flatMap((c: any) => c.plans.map((p: any) => p.id));
    expect(allPlanIds).toContain('contracts/core-types');
    expect(allPlanIds).toContain('impl/extraction');

    // Tag filtering
    logs = [];
    chunksCommand({ tag: 'foundation' });
    const filteredOutput = logs.join('\n');
    expect(filteredOutput).not.toContain('impl/extraction');
  });
});
