import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { recentCommand } from './command.ts';
import { computeRecent } from './logic.ts';
import { scanPlans } from '../../core/scanner.ts';

function createFixtureWithTimes(plans: Array<{
  id: string;
  title: string;
  status: string;
  mtime: Date;
  started_at?: string;
  not_started_at?: string;
}>): string {
  const root = mkdtempSync(join(tmpdir(), 'trellis-recent-'));
  const plansDir = join(root, 'plans');
  mkdirSync(plansDir, { recursive: true });

  mkdirSync(join(root, '.trellis'), { recursive: true });
  writeFileSync(join(root, '.trellis', 'config'), 'project: test\nplans_dir: plans\n');

  for (const plan of plans) {
    const planDir = join(plansDir, plan.id);
    mkdirSync(planDir, { recursive: true });

    const fmLines = [`title: ${plan.title}`, `status: ${plan.status}`];
    if (plan.started_at) fmLines.push(`started_at: '${plan.started_at}'`);
    if (plan.not_started_at) fmLines.push(`not_started_at: '${plan.not_started_at}'`);

    const readmePath = join(planDir, 'README.md');
    writeFileSync(readmePath, `---\n${fmLines.join('\n')}\n---\n`);

    // Set the mtime to the desired time
    utimesSync(readmePath, plan.mtime, plan.mtime);
  }

  return root;
}

describe('computeRecent', () => {
  it('returns plans modified within the time window', () => {
    const now = new Date();
    const root = createFixtureWithTimes([
      { id: 'recent-plan', title: 'Recent', status: 'in_progress', mtime: now },
    ]);

    const plans = scanPlans(join(root, 'plans'));

    const result = computeRecent({ plans, days: 1 });
    expect(result.contentChanged.map(p => p.id)).toContain('recent-plan');
  });

  it('excludes plans outside the time window', () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const root = createFixtureWithTimes([
      { id: 'old-plan', title: 'Old', status: 'draft', mtime: oldDate },
    ]);

    const plans = scanPlans(join(root, 'plans'));

    const result = computeRecent({ plans, days: 1 });
    expect(result.contentChanged).toHaveLength(0);
  });

  it('respects custom days parameter', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const root = createFixtureWithTimes([
      { id: 'mid-plan', title: 'Mid', status: 'draft', mtime: fiveDaysAgo },
    ]);

    const plans = scanPlans(join(root, 'plans'));

    const result1 = computeRecent({ plans, days: 3 });
    expect(result1.contentChanged).toHaveLength(0);

    const result2 = computeRecent({ plans, days: 7 });
    expect(result2.contentChanged).toHaveLength(1);
  });
});

describe('recentCommand', () => {
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cwdSpy = vi.spyOn(process, 'cwd');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('shows "no plans modified" message when nothing recent', () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const root = createFixtureWithTimes([
      { id: 'old', title: 'Old Plan', status: 'draft', mtime: oldDate },
    ]);
    cwdSpy.mockReturnValue(root);

    recentCommand({});
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No plans modified'));
  });

  it('shows recently modified plans', () => {
    const root = createFixtureWithTimes([
      { id: 'fresh', title: 'Fresh Plan', status: 'in_progress', mtime: new Date() },
    ]);
    cwdSpy.mockReturnValue(root);

    recentCommand({});
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('fresh');
    expect(output).toContain('Content changed');
  });

  it('outputs JSON with --json flag', () => {
    const root = createFixtureWithTimes([
      { id: 'fresh', title: 'Fresh Plan', status: 'in_progress', mtime: new Date() },
    ]);
    cwdSpy.mockReturnValue(root);

    recentCommand({ json: true });
    const jsonStr = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(jsonStr);
    expect(parsed).toHaveProperty('since');
    expect(parsed).toHaveProperty('contentChanged');
    expect(parsed).toHaveProperty('statusChanged');
    expect(parsed).toHaveProperty('newlyCreated');
    expect(parsed.contentChanged[0].id).toBe('fresh');
  });

  it('respects --days flag', () => {
    const root = createFixtureWithTimes([
      { id: 'fresh', title: 'Fresh Plan', status: 'draft', mtime: new Date() },
    ]);
    cwdSpy.mockReturnValue(root);

    recentCommand({ days: 7, json: true });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.contentChanged).toHaveLength(1);
  });

  it('rejects NaN --days with error', () => {
    recentCommand({ days: NaN });
    expect(errorSpy).toHaveBeenCalledWith('--days must be a positive number');
    expect(process.exitCode).toBe(1);
  });

  it('rejects negative --days with error', () => {
    recentCommand({ days: -3 });
    expect(errorSpy).toHaveBeenCalledWith('--days must be a positive number');
    expect(process.exitCode).toBe(1);
  });

  it('rejects zero --days with error', () => {
    recentCommand({ days: 0 });
    expect(errorSpy).toHaveBeenCalledWith('--days must be a positive number');
    expect(process.exitCode).toBe(1);
  });

  it('rejects invalid --days with JSON error when --json set', () => {
    recentCommand({ days: NaN, json: true });
    const parsed = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(parsed.error).toBe('--days must be a positive number');
    expect(process.exitCode).toBe(1);
  });
});
