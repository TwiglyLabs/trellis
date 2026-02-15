import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'fs';
import { createFixture } from './helpers.ts';
import { Trellis } from '../src/index.ts';

// Mock the HTML viewer import before importing graph command
vi.mock('../src/viewer/index.html', () => ({
  default: '<html>__TRELLIS_DATA__</html>',
}));

// Mock child_process.execFile to prevent opening browser
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { statusCommand } from '../src/commands/status.ts';
import { readyCommand } from '../src/commands/ready.ts';
import { showCommand } from '../src/commands/show.ts';
import { updateCommand } from '../src/commands/update.ts';
import { lintCommand } from '../src/commands/lint.ts';
import { graphCommand } from '../src/commands/graph.ts';
import { epicCommand } from '../src/commands/epic.ts';
import { chunksCommand } from '../src/commands/chunks.ts';

/**
 * API-CLI Consistency Tests
 *
 * These tests verify that the CLI JSON output is semantically equivalent
 * to the API return values. The CLI should be a thin wrapper around the
 * API, and their outputs should match.
 */

describe('API-CLI consistency', () => {
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

  describe('status', () => {
    it('CLI JSON matches API return values', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done', tags: ['tag1'], repo: 'public' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', tags: ['tag2'] },
        { id: 'plan-c', title: 'Plan C', status: 'not_started', depends_on: ['plan-b'] },
        { id: 'plan-d', title: 'Plan D', status: 'in_progress' },
        { id: 'plan-e', title: 'Plan E', status: 'draft' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);
      const apiResult = api.status({ showDone: true });

      statusCommand({ json: true, done: true });
      const cliOutput = JSON.parse(logs[0]);

      // Same project
      expect(cliOutput.project).toBe(apiResult.project);

      // Same total
      const apiTotal = [
        ...apiResult.byStatus.ready,
        ...apiResult.byStatus.blocked,
        ...apiResult.byStatus.inProgress,
        ...apiResult.byStatus.draft,
        ...apiResult.byStatus.done,
        ...apiResult.byStatus.archived,
      ].length;
      expect(cliOutput.total).toBe(apiTotal);

      // Same plan IDs
      const cliIds = new Set(cliOutput.plans.map((p: any) => p.id));
      const apiIds = new Set([
        ...apiResult.byStatus.ready,
        ...apiResult.byStatus.blocked,
        ...apiResult.byStatus.inProgress,
        ...apiResult.byStatus.draft,
        ...apiResult.byStatus.done,
        ...apiResult.byStatus.archived,
      ].map((p) => p.id));
      expect(cliIds).toEqual(apiIds);

      // Same ready/blocked categorization
      const cliReady = cliOutput.plans.filter((p: any) => p.ready).map((p: any) => p.id);
      const apiReady = apiResult.byStatus.ready.map((p) => p.id);
      expect(new Set(cliReady)).toEqual(new Set(apiReady));

      const cliBlocked = cliOutput.plans.filter((p: any) => p.blocked).map((p: any) => p.id);
      const apiBlocked = apiResult.byStatus.blocked.map((p) => p.id);
      expect(new Set(cliBlocked)).toEqual(new Set(apiBlocked));

      // Chunks match
      expect(cliOutput.chunks.total).toBe(apiResult.chunks.total);
      expect(cliOutput.chunks.over_budget).toBe(apiResult.chunks.overBudget);
    });

    it('respects status filters consistently', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done' },
        { id: 'plan-b', title: 'Plan B', status: 'archived' },
        { id: 'plan-c', title: 'Plan C', status: 'not_started' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);

      // Without flags
      const apiResult1 = api.status({ showDone: false, showArchived: false });
      statusCommand({ json: true });
      const cliOutput1 = JSON.parse(logs[0]);

      const apiTotal1 = [
        ...apiResult1.byStatus.ready,
        ...apiResult1.byStatus.blocked,
        ...apiResult1.byStatus.inProgress,
        ...apiResult1.byStatus.draft,
      ].length;
      expect(cliOutput1.total).toBe(apiTotal1);

      // With --done
      logs = [];
      const apiResult2 = api.status({ showDone: true, showArchived: false });
      statusCommand({ json: true, done: true });
      const cliOutput2 = JSON.parse(logs[0]);

      const apiTotal2 = [
        ...apiResult2.byStatus.ready,
        ...apiResult2.byStatus.blocked,
        ...apiResult2.byStatus.inProgress,
        ...apiResult2.byStatus.draft,
        ...apiResult2.byStatus.done,
      ].length;
      expect(cliOutput2.total).toBe(apiTotal2);
    });
  });

  describe('ready', () => {
    it('CLI JSON matches API return values', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'not_started', tags: ['tag1'], repo: 'public' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['plan-a'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);
      const apiResult = api.ready();

      readyCommand({ json: true });
      const cliOutput = JSON.parse(logs[0]);

      // Same plan IDs
      const cliIds = cliOutput.map((p: any) => p.id);
      const apiIds = apiResult.plans.map((p) => p.id);
      expect(cliIds).toEqual(apiIds);

      // Same count
      expect(cliOutput.length).toBe(apiResult.plans.length);

      // Same next pick
      if (apiResult.next) {
        expect(cliIds).toContain(apiResult.next);
      }
    });

    it('filters by tag and repo consistently', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'not_started', tags: ['tag1'], repo: 'public' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', tags: ['tag2'], repo: 'cloud' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);

      // Filter by repo
      const apiResult = api.ready({ repo: 'public' });
      readyCommand({ json: true, repo: 'public' });
      const cliOutput = JSON.parse(logs[0]);

      expect(cliOutput.map((p: any) => p.id)).toEqual(apiResult.plans.map((p) => p.id));

      // Filter by tag
      logs = [];
      const apiResult2 = api.ready({ tag: 'tag2' });
      readyCommand({ json: true, tag: 'tag2' });
      const cliOutput2 = JSON.parse(logs[0]);

      expect(cliOutput2.map((p: any) => p.id)).toEqual(apiResult2.plans.map((p) => p.id));
    });
  });

  describe('show', () => {
    it('CLI JSON matches API return values', () => {
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

      const api = new Trellis(root);
      const apiResult = api.show('plan-b');

      showCommand('plan-b', { json: true });
      const cliOutput = JSON.parse(logs[0]);

      expect(apiResult).toBeDefined();
      if (!apiResult) return;

      // Core fields match
      expect(cliOutput.id).toBe(apiResult.id);
      expect(cliOutput.title).toBe(apiResult.title);
      expect(cliOutput.status).toBe(apiResult.status);
      expect(cliOutput.blocked).toBe(apiResult.blocked);
      expect(cliOutput.ready).toBe(apiResult.ready);

      // Dependency IDs match
      const cliDepIds = cliOutput.depends_on.map((d: any) => d.id);
      const apiDepIds = apiResult.dependsOn.map((d) => d.id);
      expect(cliDepIds).toEqual(apiDepIds);

      // Blocks match
      expect(new Set(cliOutput.blocks)).toEqual(new Set(apiResult.blocks));

      // Critical path matches
      expect(cliOutput.critical_path).toEqual(apiResult.criticalPath);

      // Timestamps match
      expect(cliOutput.started_at).toBe(apiResult.startedAt);
      expect(cliOutput.completed_at).toBe(apiResult.completedAt);
    });

    it('returns null for nonexistent plan consistently', () => {
      const { root } = createFixture([]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);
      const apiResult = api.show('nonexistent');

      showCommand('nonexistent', { json: true });
      const cliOutput = JSON.parse(errors[0]);

      expect(apiResult).toBe(null);
      expect(cliOutput).toHaveProperty('error');
      expect(process.exitCode).toBe(1);
    });
  });

  describe('update', () => {
    it('CLI JSON matches API return values', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['plan-a'] },
        { id: 'plan-c', title: 'Plan C', status: 'not_started' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);
      const apiResult = api.update('plan-c', 'done');

      // Create new instance for CLI call (fresh state)
      process.cwd = () => root;
      const { root: root2 } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['plan-a'] },
        { id: 'plan-c', title: 'Plan C', status: 'not_started' },
      ]);
      process.cwd = () => root2;

      updateCommand('plan-c', 'done', { json: true });
      const cliOutput = JSON.parse(logs[0]);

      expect(cliOutput.id).toBe(apiResult.id);
      expect(cliOutput.previous_status).toBe(apiResult.previousStatus);
      expect(cliOutput.status).toBe(apiResult.newStatus);
      expect(cliOutput.backward).toBe(apiResult.backward);
      expect(new Set(cliOutput.newly_ready)).toEqual(new Set(apiResult.newlyReady));

      // Clean up second fixture
      try {
        rmSync(root2, { recursive: true, force: true });
      } catch (e) {
        // ignore
      }
    });

    it('detects backward transitions consistently', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);
      const apiResult = api.update('plan-a', 'in_progress');

      // Create fresh fixture for CLI
      const { root: root2 } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done' },
      ]);
      process.cwd = () => root2;

      updateCommand('plan-a', 'in_progress', { json: true });
      const cliOutput = JSON.parse(logs[0]);

      expect(cliOutput.backward).toBe(apiResult.backward);
      expect(apiResult.backward).toBe(true);

      // Clean up
      try {
        rmSync(root2, { recursive: true, force: true });
      } catch (e) {
        // ignore
      }
    });
  });

  describe('lint', () => {
    it('CLI JSON matches API return values', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['nonexistent'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);
      const apiResult = api.lint();

      lintCommand({ json: true });
      const cliOutput = JSON.parse(logs[0]);

      expect(cliOutput.ok).toBe(apiResult.ok);
      expect(cliOutput.total).toBe(apiResult.total);
      expect(cliOutput.ok_count).toBe(apiResult.okCount);
      expect(cliOutput.errors.length).toBe(apiResult.errors.length);
      expect(cliOutput.warnings.length).toBe(apiResult.warnings.length);
      expect(cliOutput.contract_coverage).toBe(apiResult.contractCoverage);
    });

    it('reports same error details', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'not_started', depends_on: ['nonexistent'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);
      const apiResult = api.lint();

      lintCommand({ json: true });
      const cliOutput = JSON.parse(logs[0]);

      expect(apiResult.errors.length).toBeGreaterThan(0);
      expect(cliOutput.errors.length).toBe(apiResult.errors.length);

      const apiError = apiResult.errors[0];
      const cliError = cliOutput.errors[0];

      expect(cliError.plan_id).toBe(apiError.planId);
      expect(cliError.type).toBe(apiError.type);
      expect(cliError.message).toBe(apiError.message);
    });
  });

  describe('graph', () => {
    it('CLI JSON matches API return values', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done', tags: ['tag1'] },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['plan-a'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);
      const apiResult = api.graph();

      graphCommand({ json: true });
      const cliOutput = JSON.parse(logs[0]);

      // Same number of nodes
      expect(cliOutput.nodes.length).toBe(apiResult.nodes.length);

      // Same node IDs
      const cliNodeIds = new Set(cliOutput.nodes.map((n: any) => n.id));
      const apiNodeIds = new Set(apiResult.nodes.map((n) => n.id));
      expect(cliNodeIds).toEqual(apiNodeIds);

      // Same number of edges
      expect(cliOutput.edges.length).toBe(apiResult.edges.length);

      // Same edge structure
      const cliEdgeKeys = new Set(cliOutput.edges.map((e: any) => `${e.from}->${e.to}`));
      const apiEdgeKeys = new Set(apiResult.edges.map((e) => `${e.from}->${e.to}`));
      expect(cliEdgeKeys).toEqual(apiEdgeKeys);
    });

    it('nodes have same blocked/ready status', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done' },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', depends_on: ['plan-a'] },
        { id: 'plan-c', title: 'Plan C', status: 'not_started', depends_on: ['plan-d'] },
        { id: 'plan-d', title: 'Plan D', status: 'not_started' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);
      const apiResult = api.graph();

      graphCommand({ json: true });
      const cliOutput = JSON.parse(logs[0]);

      for (const cliNode of cliOutput.nodes) {
        const apiNode = apiResult.nodes.find((n) => n.id === cliNode.id);
        expect(apiNode).toBeDefined();
        if (apiNode) {
          expect(cliNode.blocked).toBe(apiNode.blocked);
          expect(cliNode.ready).toBe(apiNode.ready);
        }
      }
    });
  });

  describe('epic', () => {
    it('lists all epics consistently', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done', tags: ['epic:auth'] },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', tags: ['epic:auth'] },
        { id: 'plan-c', title: 'Plan C', status: 'in_progress', tags: ['epic:api'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);
      const apiResult = api.epic();

      epicCommand({ json: true });
      const cliOutput = JSON.parse(logs[0]);

      expect(cliOutput.length).toBe(apiResult.length);

      const cliEpics = new Set(cliOutput.map((e: any) => e.epic));
      const apiEpics = new Set(apiResult.map((e) => e.epic));
      expect(cliEpics).toEqual(apiEpics);

      // Check first epic details
      const cliEpic = cliOutput[0];
      const apiEpic = apiResult.find((e) => e.epic === cliEpic.epic);
      expect(apiEpic).toBeDefined();
      if (apiEpic) {
        expect(cliEpic.total).toBe(apiEpic.total);
        expect(cliEpic.done).toBe(apiEpic.done);
        expect(cliEpic.in_progress).toBe(apiEpic.inProgress);
        expect(cliEpic.not_started).toBe(apiEpic.notStarted);
        expect(cliEpic.progress).toBe(apiEpic.progress);
      }
    });

    it('shows single epic consistently', () => {
      const { root } = createFixture([
        { id: 'plan-a', title: 'Plan A', status: 'done', tags: ['epic:auth'] },
        { id: 'plan-b', title: 'Plan B', status: 'not_started', tags: ['epic:auth'] },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);
      const apiResult = api.epic('auth');

      epicCommand({ json: true }, 'auth');
      const cliOutput = JSON.parse(logs[0]);

      expect(apiResult.length).toBe(1);
      const apiEpic = apiResult[0];

      expect(cliOutput.epic).toBe(apiEpic.epic);
      expect(cliOutput.total).toBe(apiEpic.total);
      expect(cliOutput.done).toBe(apiEpic.done);
      expect(cliOutput.plans.length).toBe(apiEpic.plans?.length || 0);
    });
  });

  describe('chunks', () => {
    it('CLI JSON matches API return values', () => {
      const { root } = createFixture([
        { id: 'auth/plan-a', title: 'Plan A', status: 'not_started' },
        { id: 'auth/plan-b', title: 'Plan B', status: 'not_started' },
        { id: 'api/plan-c', title: 'Plan C', status: 'not_started' },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);
      const apiResult = api.chunks();

      chunksCommand({ json: true });
      const cliOutput = JSON.parse(logs[0]);

      expect(cliOutput.chunks.length).toBe(apiResult.chunks.length);
      expect(cliOutput.crossChunkEdges.length).toBe(apiResult.crossChunkEdges.length);

      // Same chunk IDs
      const cliChunkIds = new Set(cliOutput.chunks.map((c: any) => c.id));
      const apiChunkIds = new Set(apiResult.chunks.map((c) => c.id));
      expect(cliChunkIds).toEqual(apiChunkIds);
    });

    it('chunk details match', () => {
      const { root } = createFixture([
        { id: 'auth/plan-a', title: 'Plan A', status: 'not_started', body: 'x'.repeat(1000) },
        { id: 'auth/plan-b', title: 'Plan B', status: 'not_started', body: 'y'.repeat(2000) },
      ]);
      fixtureRoot = root;
      process.cwd = () => root;

      const api = new Trellis(root);
      const apiResult = api.chunks();

      chunksCommand({ json: true });
      const cliOutput = JSON.parse(logs[0]);

      for (const cliChunk of cliOutput.chunks) {
        const apiChunk = apiResult.chunks.find((c) => c.id === cliChunk.id);
        expect(apiChunk).toBeDefined();
        if (apiChunk) {
          expect(cliChunk.planCount).toBe(apiChunk.planCount);
          expect(cliChunk.totalLines).toBe(apiChunk.totalLines);
          expect(new Set(cliChunk.plans.map((p: any) => p.id))).toEqual(
            new Set(apiChunk.plans.map((p) => p.id))
          );
        }
      }
    });
  });
});
