/**
 * Tests for optional Logger injection in createContextAsync and createMultiContextAsync.
 *
 * These tests verify that:
 * - Both functions accept an optional logger in their options
 * - The logger is called for key operations (plan scanning, graph computation, config loading)
 * - When no logger is provided, functions work exactly as before (backwards compat)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { rmSync } from 'fs';
import { createContextAsync, createMultiContextAsync } from './context.ts';
import { createFixture } from '../__tests__/helpers.ts';
import type { Logger } from '@twiglylabs/log';

function makeMockLogger(): Logger & { calls: { method: string; msg: string; ctx?: Record<string, unknown> }[] } {
  const calls: { method: string; msg: string; ctx?: Record<string, unknown> }[] = [];
  const logger: Logger & { calls: typeof calls } = {
    calls,
    debug(msg, ctx) { calls.push({ method: 'debug', msg, ctx }); },
    info(msg, ctx) { calls.push({ method: 'info', msg, ctx }); },
    warn(msg, ctx) { calls.push({ method: 'warn', msg, ctx }); },
    error(msg, ctx) { calls.push({ method: 'error', msg, ctx }); },
    child(service) {
      const child = makeMockLogger();
      // Redirect child calls back to the root's calls array with service prefix
      const childLogger: Logger & { calls: typeof calls } = {
        calls,
        debug(msg, ctx) { calls.push({ method: 'debug', msg: `[${service}] ${msg}`, ctx }); },
        info(msg, ctx) { calls.push({ method: 'info', msg: `[${service}] ${msg}`, ctx }); },
        warn(msg, ctx) { calls.push({ method: 'warn', msg: `[${service}] ${msg}`, ctx }); },
        error(msg, ctx) { calls.push({ method: 'error', msg: `[${service}] ${msg}`, ctx }); },
        child: child.child,
      };
      return childLogger;
    },
  };
  return logger;
}

describe('createContextAsync logger injection', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('works without a logger (backwards compatible)', async () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    root = fixture.root;

    // Must not throw when no logger provided
    const ctx = await createContextAsync(root);
    expect(ctx.plans).toHaveLength(2);
    expect(ctx.graph.ready.has('b')).toBe(true);
  });

  it('accepts a logger in options and calls it for plan scanning', async () => {
    const fixture = createFixture([
      { id: 'a', title: 'Plan A', status: 'done' },
      { id: 'b', title: 'Plan B', status: 'not_started', depends_on: ['a'] },
    ]);
    root = fixture.root;

    const logger = makeMockLogger();
    const ctx = await createContextAsync(root, { logger });

    expect(ctx.plans).toHaveLength(2);
    expect(ctx.graph.ready.has('b')).toBe(true);

    // Logger should have been called at least once during the operation
    expect(logger.calls.length).toBeGreaterThan(0);

    // Should have logged something about scanning or plans
    const messages = logger.calls.map(c => c.msg.toLowerCase());
    const hasRelevantLog = messages.some(m =>
      m.includes('scan') || m.includes('plan') || m.includes('graph') || m.includes('config') || m.includes('loaded')
    );
    expect(hasRelevantLog).toBe(true);
  });

  it('logs plan count after scanning', async () => {
    const fixture = createFixture([
      { id: 'x', title: 'Plan X', status: 'not_started' },
      { id: 'y', title: 'Plan Y', status: 'not_started' },
      { id: 'z', title: 'Plan Z', status: 'done', depends_on: ['x'] },
    ]);
    root = fixture.root;

    const logger = makeMockLogger();
    await createContextAsync(root, { logger });

    // There should be a log entry with plan count context
    const callsWithPlanCount = logger.calls.filter(c =>
      c.ctx && typeof c.ctx['planCount'] === 'number'
    );
    expect(callsWithPlanCount.length).toBeGreaterThan(0);
    expect(callsWithPlanCount[0].ctx!['planCount']).toBe(3);
  });

  it('logs graph node and edge counts', async () => {
    const fixture = createFixture([
      { id: 'a', title: 'A', status: 'done' },
      { id: 'b', title: 'B', status: 'not_started', depends_on: ['a'] },
    ]);
    root = fixture.root;

    const logger = makeMockLogger();
    await createContextAsync(root, { logger });

    // Should have logged graph stats
    const graphCalls = logger.calls.filter(c =>
      c.ctx && typeof c.ctx['nodes'] === 'number'
    );
    expect(graphCalls.length).toBeGreaterThan(0);
    expect(graphCalls[0].ctx!['nodes']).toBe(2);
  });
});

describe('createMultiContextAsync logger injection', () => {
  let roots: string[] = [];

  afterEach(() => {
    for (const r of roots) {
      rmSync(r, { recursive: true, force: true });
    }
    roots = [];
  });

  it('works without a logger (backwards compatible)', async () => {
    const f1 = createFixture([{ id: 'a', title: 'A', status: 'done' }]);
    const f2 = createFixture([{ id: 'b', title: 'B', status: 'not_started' }]);
    roots = [f1.root, f2.root];

    const ctx = await createMultiContextAsync([
      { path: f1.root, alias: 'repo1' },
      { path: f2.root, alias: 'repo2' },
    ]);
    expect(ctx.plans).toHaveLength(2);
  });

  it('accepts a logger and calls it during multi-repo scanning', async () => {
    const f1 = createFixture([{ id: 'a', title: 'A', status: 'done' }]);
    const f2 = createFixture([{ id: 'b', title: 'B', status: 'not_started' }]);
    roots = [f1.root, f2.root];

    const logger = makeMockLogger();
    const ctx = await createMultiContextAsync(
      [
        { path: f1.root, alias: 'repo1' },
        { path: f2.root, alias: 'repo2' },
      ],
      { logger },
    );

    expect(ctx.plans).toHaveLength(2);
    expect(logger.calls.length).toBeGreaterThan(0);

    // Should log something about repos or plans
    const messages = logger.calls.map(c => c.msg.toLowerCase());
    const hasRelevantLog = messages.some(m =>
      m.includes('repo') || m.includes('plan') || m.includes('scan') || m.includes('graph')
    );
    expect(hasRelevantLog).toBe(true);
  });

  it('logs total plan count and repo count for multi-context', async () => {
    const f1 = createFixture([
      { id: 'p1', title: 'P1', status: 'done' },
      { id: 'p2', title: 'P2', status: 'not_started' },
    ]);
    const f2 = createFixture([{ id: 'p3', title: 'P3', status: 'not_started' }]);
    roots = [f1.root, f2.root];

    const logger = makeMockLogger();
    await createMultiContextAsync(
      [
        { path: f1.root, alias: 'r1' },
        { path: f2.root, alias: 'r2' },
      ],
      { logger },
    );

    // Should log graph info with total nodes (2 repos * plans, qualified IDs)
    const graphCalls = logger.calls.filter(c => c.ctx && typeof c.ctx['nodes'] === 'number');
    expect(graphCalls.length).toBeGreaterThan(0);
    expect(graphCalls[0].ctx!['nodes']).toBe(3); // 2 + 1 plans
  });
});
