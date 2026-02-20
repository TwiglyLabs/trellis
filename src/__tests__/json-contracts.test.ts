import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'fs';
import { createFixture } from './helpers.ts';

// Mock the HTML viewer import before importing graph command
vi.mock('../viewer/index.html', () => ({
  default: '<html>__TRELLIS_DATA__</html>',
}));

// Mock child_process.execFile to prevent opening browser
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { statusCommand } from '../features/status/command.ts';
import { readyCommand } from '../features/ready/command.ts';
import { showCommand } from '../features/show/command.ts';
import { updateCommand } from '../features/update/command.ts';
import { lintCommand } from '../features/lint/command.ts';
import { graphCommand } from '../commands/graph.ts';
import { epicCommand } from '../features/epic/command.ts';
import { chunksCommand } from '../features/chunks/command.ts';

/**
 * JSON Contract Tests
 *
 * These tests lock down the JSON output schema for all trellis commands.
 * They verify field names use snake_case where applicable and prevent
 * breaking changes to the JSON API.
 */

describe('JSON contracts', () => {
  let originalCwd: () => string;
  let logs: string[];
  let errors: string[];
  let fixtureRoot: string | null = null;

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
    if (fixtureRoot) {
      try {
        rmSync(fixtureRoot, { recursive: true, force: true });
      } catch (e) {
        // ignore cleanup errors
      }
      fixtureRoot = null;
    }
  });

  describe('status --json', () => {
    it('outputs correct field names and structure', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done', tags: ['tag1'], repo: 'public' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', tags: ['tag2'] },
        { id: 'plan-c', title: 'Plan C', status: 'not_started', depends_on: ['plan-b'] },
        { id: 'plan-d', title: 'Plan D', status: 'in_progress', assignee: 'alice' },
        { id: 'plan-e', title: 'Plan E', status: 'draft' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      statusCommand({ json: true, all: true });

      const output = JSON.parse(logs[0]);

      // Top-level fields
      expect(output).toHaveProperty('project');
      expect(output).toHaveProperty('total');
      expect(output).toHaveProperty('chunks');
      expect(output).toHaveProperty('plans');

      // Chunks object
      expect(output.chunks).toHaveProperty('total');
      expect(output.chunks).toHaveProperty('over_budget');
      expect(typeof output.chunks.over_budget).toBe('number');

      // Plans array
      expect(Array.isArray(output.plans)).toBe(true);
      expect(output.plans.length).toBe(5);

      // Plan fields - required fields always present
      const plan = output.plans[0];
      expect(plan).toHaveProperty('id');
      expect(plan).toHaveProperty('title');
      expect(plan).toHaveProperty('status');
      expect(plan).toHaveProperty('blocked');
      expect(plan).toHaveProperty('ready');
      expect(plan).toHaveProperty('depends_on');
      expect(plan).toHaveProperty('tags');
      // Optional fields: repo, assignee (only present if defined)

      // Blocked plan has waiting_on
      const blockedPlan = output.plans.find((p: any) => p.id === 'plan-c');
      expect(blockedPlan).toHaveProperty('waiting_on');
      expect(Array.isArray(blockedPlan.waiting_on)).toBe(true);
      expect(blockedPlan.blocked).toBe(true);

      // Ready plan
      const readyPlan = output.plans.find((p: any) => p.id === 'plan-b');
      expect(readyPlan.ready).toBe(true);
    });

    it('filters by status flags', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done' },
        { id: 'plan-b', title: 'Plan B', status: 'archived' },
        { id: 'plan-c', title: 'Plan C', status: 'not_started' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      // Without --all, done and archived are excluded
      statusCommand({ json: true });
      let output = JSON.parse(logs[0]);
      expect(output.total).toBe(1);
      expect(output.plans.find((p: any) => p.status === 'done')).toBeUndefined();
      expect(output.plans.find((p: any) => p.status === 'archived')).toBeUndefined();

      // With --done, done is included
      logs = [];
      statusCommand({ json: true, done: true });
      output = JSON.parse(logs[0]);
      expect(output.total).toBe(2);
      expect(output.plans.find((p: any) => p.status === 'done')).toBeDefined();

      // With --all, all are included
      logs = [];
      statusCommand({ json: true, all: true });
      output = JSON.parse(logs[0]);
      expect(output.total).toBe(3);
    });
  });

  describe('ready --json', () => {
    it('outputs array of plans with correct fields', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'not_started', tags: ['tag1'], repo: 'public', description: 'Description A' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['plan-a'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      readyCommand({ json: true });

      const output = JSON.parse(logs[0]);
      expect(Array.isArray(output)).toBe(true);
      expect(output.length).toBe(1);

      const plan = output[0];
      // Required fields
      expect(plan).toHaveProperty('id');
      expect(plan).toHaveProperty('title');
      expect(plan).toHaveProperty('status');
      expect(plan).toHaveProperty('depends_on');
      expect(plan).toHaveProperty('tags');
      // Optional fields: repo, description, assignee (only in output if defined)

      expect(plan.id).toBe('plan-a');
      expect(plan.repo).toBe('public');
      expect(plan.description).toBe('Description A');
      expect(Array.isArray(plan.depends_on)).toBe(true);
    });

    it('outputs single plan with --next flag', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'not_started' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      readyCommand({ json: true, next: true });

      const output = JSON.parse(logs[0]);
      expect(output).toHaveProperty('id');
      expect(output).toHaveProperty('title');
      expect(output).toHaveProperty('status');
      expect(output).toHaveProperty('depends_on');
    });

    it('outputs null when no plans are ready with --next', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      readyCommand({ json: true, next: true });

      const output = JSON.parse(logs[0]);
      expect(output).toBe(null);
    });
  });

  describe('show --json', () => {
    it('outputs plan details with correct field names', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done', tags: ['tag1'], repo: 'public' },
        {
          id: 'plan-b',
          title: 'Plan B',
          status: 'in_progress',
          depends_on: ['plan-a'],
          description: 'Description B',
          assignee: 'alice',
          started_at: '2026-02-11T10:00:00Z',
        },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      showCommand('plan-b', { json: true });

      const output = JSON.parse(logs[0]);

      // Required fields
      expect(output).toHaveProperty('id');
      expect(output).toHaveProperty('filePath');
      expect(output).toHaveProperty('title');
      expect(output).toHaveProperty('status');
      expect(output).toHaveProperty('blocked');
      expect(output).toHaveProperty('ready');
      expect(output).toHaveProperty('depends_on');
      expect(output).toHaveProperty('blocks');
      expect(output).toHaveProperty('critical_path');

      // Optional fields with snake_case - only present if defined
      // This plan has started_at but no completed_at
      expect(output.started_at).toBe('2026-02-11T10:00:00Z');

      // depends_on structure
      expect(Array.isArray(output.depends_on)).toBe(true);
      if (output.depends_on.length > 0) {
        const dep = output.depends_on[0];
        expect(dep).toHaveProperty('id');
        expect(dep).toHaveProperty('status');
        expect(dep).toHaveProperty('satisfied');
      }

      expect(output.id).toBe('plan-b');
      expect(output.started_at).toBe('2026-02-11T10:00:00Z');
    });

    it('includes contracts when --contracts flag is set', () => {
      const { root } = createFixture([
        {
          id: 'plan-a',
          title: 'Plan A',
          status: 'not_started',
          directory: true,
          outputsMd: '## Outputs\n\n- output 1\n- output 2',
          inputsMd: '## Inputs\n\n- input 1',
        },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      showCommand('plan-a', { json: true, contracts: true });

      const output = JSON.parse(logs[0]);
      expect(output).toHaveProperty('inputs');
      expect(output).toHaveProperty('outputs');
    });

    it('errors with correct format when plan not found', () => {
      const { root } = createFixture([]);
      fixtureRoot = root;
      process.cwd = () => root;

      showCommand('nonexistent', { json: true });

      const output = JSON.parse(errors[0]);
      expect(output).toHaveProperty('error');
      expect(output.error).toContain('not found');
      expect(process.exitCode).toBe(1);
    });
  });

  describe('update --json', () => {
    it('outputs update result with correct field names', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['plan-a'] },
        { id: 'plan-c', title: 'Plan C', status: 'not_started' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      updateCommand('plan-c', 'done', { json: true, force: true });

      const output = JSON.parse(logs[0]);

      expect(output).toHaveProperty('id');
      expect(output).toHaveProperty('previous_status');
      expect(output).toHaveProperty('status'); // NOT newStatus
      expect(output).toHaveProperty('backward');
      expect(output).toHaveProperty('newly_ready');

      expect(output.id).toBe('plan-c');
      expect(output.previous_status).toBe('not_started');
      expect(output.status).toBe('done');
      expect(typeof output.backward).toBe('boolean');
      expect(Array.isArray(output.newly_ready)).toBe(true);
    });

    it('includes newly_ready plans', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'not_started' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['plan-a'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      updateCommand('plan-a', 'done', { json: true, force: true });

      const output = JSON.parse(logs[0]);
      expect(output.newly_ready).toContain('plan-b');
    });

    it('flags backward transitions', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      updateCommand('plan-a', 'in_progress', { json: true, force: true });

      const output = JSON.parse(logs[0]);
      expect(output.backward).toBe(true);
    });
  });

  describe('lint --json', () => {
    it('outputs lint results with correct field names', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['nonexistent'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      lintCommand({ json: true });

      const output = JSON.parse(logs[0]);

      expect(output).toHaveProperty('ok');
      expect(output).toHaveProperty('total');
      expect(output).toHaveProperty('ok_count');
      expect(output).toHaveProperty('errors');
      expect(output).toHaveProperty('warnings');
      expect(output).toHaveProperty('structural');

      expect(typeof output.ok).toBe('boolean');
      expect(typeof output.ok_count).toBe('number');
      expect(output.structural).toHaveProperty('errors');
      expect(output.structural).toHaveProperty('warnings');
      expect(Array.isArray(output.errors)).toBe(true);
      expect(Array.isArray(output.warnings)).toBe(true);
    });

    it('outputs error/warning objects with plan_id', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'not_started', depends_on: ['nonexistent'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      lintCommand({ json: true });

      const output = JSON.parse(logs[0]);
      expect(output.errors.length).toBeGreaterThan(0);

      const error = output.errors[0];
      expect(error).toHaveProperty('plan_id');
      expect(error).toHaveProperty('type');
      expect(error).toHaveProperty('message');
      expect(error.plan_id).toBe('plan-a');
    });
  });

  describe('graph --json', () => {
    it('outputs graph with nodes and edges', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done', tags: ['tag1'] },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['plan-a'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      graphCommand({ json: true });

      const output = JSON.parse(logs[0]);

      expect(output).toHaveProperty('nodes');
      expect(output).toHaveProperty('edges');
      expect(Array.isArray(output.nodes)).toBe(true);
      expect(Array.isArray(output.edges)).toBe(true);
    });

    it('nodes have correct field names', () => {
      const { root } = createFixture([
        {
          id: 'plan-a',
          title: 'Plan A',
          status: 'not_started',
          tags: ['tag1'],
          repo: 'public',
          assignee: 'alice',
        },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['plan-a'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      graphCommand({ json: true });

      const output = JSON.parse(logs[0]);
      const node = output.nodes[0];

      expect(node).toHaveProperty('id');
      expect(node).toHaveProperty('title');
      expect(node).toHaveProperty('status');
      expect(node).toHaveProperty('blocked');
      expect(node).toHaveProperty('ready');
      expect(node).toHaveProperty('depends_on');
      expect(node).toHaveProperty('tags');
      expect(node).toHaveProperty('repo');
      expect(node).toHaveProperty('assignee');

      expect(Array.isArray(node.depends_on)).toBe(true);
    });

    it('edges have from and to fields', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['plan-a'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      graphCommand({ json: true });

      const output = JSON.parse(logs[0]);
      expect(output.edges.length).toBeGreaterThan(0);

      const edge = output.edges[0];
      expect(edge).toHaveProperty('from');
      expect(edge).toHaveProperty('to');
    });
  });

  describe('epic --json', () => {
    it('lists all epics with correct field names', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done', tags: ['epic:auth'] },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', tags: ['epic:auth'] },
        { id: 'plan-c', title: 'Plan C', status: 'in_progress', tags: ['epic:api'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      epicCommand({ json: true });

      const output = JSON.parse(logs[0]);
      expect(Array.isArray(output)).toBe(true);
      expect(output.length).toBe(2);

      const epic = output[0];
      expect(epic).toHaveProperty('epic');
      expect(epic).toHaveProperty('total');
      expect(epic).toHaveProperty('done');
      expect(epic).toHaveProperty('in_progress');
      expect(epic).toHaveProperty('not_started');
      expect(epic).toHaveProperty('blocked');
      expect(epic).toHaveProperty('draft');
      expect(epic).toHaveProperty('progress');

      expect(typeof epic.progress).toBe('number');
    });

    it('shows single epic with plans when name provided', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done', tags: ['epic:auth'] },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', tags: ['epic:auth'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      epicCommand({ json: true }, 'auth');

      const output = JSON.parse(logs[0]);

      expect(output).toHaveProperty('epic');
      expect(output).toHaveProperty('total');
      expect(output).toHaveProperty('done');
      expect(output).toHaveProperty('in_progress');
      expect(output).toHaveProperty('not_started');
      expect(output).toHaveProperty('blocked');
      expect(output).toHaveProperty('draft');
      expect(output).toHaveProperty('progress');
      expect(output).toHaveProperty('plans');

      expect(Array.isArray(output.plans)).toBe(true);

      const plan = output.plans[0];
      expect(plan).toHaveProperty('id');
      expect(plan).toHaveProperty('title');
      expect(plan).toHaveProperty('status');
      expect(plan).toHaveProperty('blocked');
      expect(plan).toHaveProperty('ready');
    });
  });

  describe('chunks --json', () => {
    it('outputs chunk result with correct structure', () => {
      const { root } = createFixture([
        { id: 'auth/plan-a', title: 'Plan A', status: 'not_started' },
        { id: 'auth/plan-b', title: 'Plan B', status: 'not_started' },
        { id: 'api/plan-c', title: 'Plan C', status: 'not_started' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      chunksCommand({ json: true });

      const output = JSON.parse(logs[0]);

      expect(output).toHaveProperty('chunks');
      expect(output).toHaveProperty('crossChunkEdges');
      expect(output).toHaveProperty('config');

      expect(Array.isArray(output.chunks)).toBe(true);
      expect(Array.isArray(output.crossChunkEdges)).toBe(true);
    });

    it('chunk objects have correct fields', () => {
      const { root } = createFixture([
        { id: 'auth/plan-a', title: 'Plan A', status: 'not_started', body: 'x'.repeat(5000) },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      chunksCommand({ json: true });

      const output = JSON.parse(logs[0]);
      expect(output.chunks.length).toBeGreaterThan(0);

      const chunk = output.chunks[0];
      expect(chunk).toHaveProperty('id');
      expect(chunk).toHaveProperty('plans');
      expect(chunk).toHaveProperty('planCount');
      expect(chunk).toHaveProperty('totalLines');

      expect(Array.isArray(chunk.plans)).toBe(true);
    });
  });
});
