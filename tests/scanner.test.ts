import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { derivePlanId, scanPlans, loadConfig } from '../src/scanner.ts';

function createFixtureDir(): string {
  return mkdtempSync(join(tmpdir(), 'trellis-test-'));
}

function writePlan(dir: string, path: string, frontmatter: Record<string, any>, body = '') {
  const fullPath = join(dir, path);
  const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
  mkdirSync(parentDir, { recursive: true });

  const fm = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}:\n${v.map(i => `  - ${i}`).join('\n')}`;
      }
      return `${k}: ${v}`;
    })
    .join('\n');

  writeFileSync(fullPath, `---\n${fm}\n---\n${body}`);
}

describe('derivePlanId', () => {
  it('derives ID from single-file plan', () => {
    expect(derivePlanId('/plans/contracts/core-types.md', '/plans')).toBe('contracts/core-types');
  });

  it('derives ID from directory plan README', () => {
    expect(derivePlanId('/plans/impl/core-extraction/README.md', '/plans')).toBe('impl/core-extraction');
  });

  it('handles top-level plans', () => {
    expect(derivePlanId('/plans/quick-fix.md', '/plans')).toBe('quick-fix');
  });
});

describe('scanPlans', () => {
  it('discovers single-file plans', () => {
    const dir = createFixtureDir();
    const plansDir = join(dir, 'plans');
    writePlan(dir, 'plans/a.md', { title: 'Plan A', status: 'draft' });
    writePlan(dir, 'plans/b.md', { title: 'Plan B', status: 'not_started' });

    const plans = scanPlans(plansDir);
    expect(plans).toHaveLength(2);
    expect(plans.map(p => p.id).sort()).toEqual(['a', 'b']);
  });

  it('discovers nested plans', () => {
    const dir = createFixtureDir();
    const plansDir = join(dir, 'plans');
    writePlan(dir, 'plans/contracts/core.md', { title: 'Core', status: 'draft' });
    writePlan(dir, 'plans/contracts/auth.md', { title: 'Auth', status: 'draft' });

    const plans = scanPlans(plansDir);
    expect(plans).toHaveLength(2);
    expect(plans.map(p => p.id).sort()).toEqual(['contracts/auth', 'contracts/core']);
  });

  it('discovers directory plans via README.md', () => {
    const dir = createFixtureDir();
    const plansDir = join(dir, 'plans');
    writePlan(dir, 'plans/impl/extraction/README.md', { title: 'Extraction', status: 'in_progress' });
    writePlan(dir, 'plans/impl/extraction/sub-file.md', { title: 'Sub File', status: 'draft' });

    const plans = scanPlans(plansDir);
    expect(plans).toHaveLength(1);
    expect(plans[0].id).toBe('impl/extraction');
  });

  it('ignores files without frontmatter', () => {
    const dir = createFixtureDir();
    const plansDir = join(dir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, 'notes.md'), '# Just notes\nNo frontmatter here.');
    writePlan(dir, 'plans/real.md', { title: 'Real Plan', status: 'draft' });

    const plans = scanPlans(plansDir);
    expect(plans).toHaveLength(1);
    expect(plans[0].id).toBe('real');
  });

  it('handles empty directory', () => {
    const dir = createFixtureDir();
    const plansDir = join(dir, 'plans');
    mkdirSync(plansDir, { recursive: true });

    const plans = scanPlans(plansDir);
    expect(plans).toHaveLength(0);
  });

  it('computes lineCount from file content', () => {
    const dir = createFixtureDir();
    const plansDir = join(dir, 'plans');
    writePlan(dir, 'plans/test.md', { title: 'Test', status: 'draft' }, 'line1\nline2\nline3');

    const plans = scanPlans(plansDir);
    // frontmatter: ---\ntitle: Test\nstatus: draft\n---\nline1\nline2\nline3
    expect(plans[0].lineCount).toBe(7);
  });

  it('preserves frontmatter data', () => {
    const dir = createFixtureDir();
    const plansDir = join(dir, 'plans');
    writePlan(dir, 'plans/test.md', {
      title: 'Test Plan',
      status: 'not_started',
      depends_on: ['a', 'b'],
      tags: ['foundation'],
      repo: 'public',
    }, '\n# Body\n');

    const plans = scanPlans(plansDir);
    expect(plans[0].frontmatter.depends_on).toEqual(['a', 'b']);
    expect(plans[0].frontmatter.tags).toEqual(['foundation']);
    expect(plans[0].frontmatter.repo).toBe('public');
    expect(plans[0].body).toContain('# Body');
  });
});

describe('loadConfig', () => {
  it('reads .trellis config file', () => {
    const dir = createFixtureDir();
    writeFileSync(join(dir, '.trellis'), 'project: acorn\nplans_dir: docs/plans\n');

    const config = loadConfig(dir);
    expect(config.project).toBe('acorn');
    expect(config.plans_dir).toBe('docs/plans');
  });

  it('falls back to defaults', () => {
    const dir = createFixtureDir();
    const config = loadConfig(dir);
    expect(config.plans_dir).toBe('plans');
  });

  it('uses dir name as project name when no config', () => {
    const dir = createFixtureDir();
    const config = loadConfig(dir);
    expect(config.project).toBeTruthy();
  });

  it('strips inline comments from config values', () => {
    const dir = createFixtureDir();
    writeFileSync(join(dir, '.trellis'), 'project: acorn # my project\nplans_dir: docs/plans # custom dir\n');

    const config = loadConfig(dir);
    expect(config.project).toBe('acorn');
    expect(config.plans_dir).toBe('docs/plans');
  });

  it('parses chunk_max_lines from config', () => {
    const dir = createFixtureDir();
    writeFileSync(join(dir, '.trellis'), 'project: test\nchunk_max_lines: 5000\n');

    const config = loadConfig(dir);
    expect(config.chunk_max_lines).toBe(5000);
  });

  it('returns undefined chunk_max_lines when key absent', () => {
    const dir = createFixtureDir();
    writeFileSync(join(dir, '.trellis'), 'project: test\n');

    const config = loadConfig(dir);
    expect(config.chunk_max_lines).toBeUndefined();
  });

  it('ignores invalid chunk_max_lines values', () => {
    const dir = createFixtureDir();
    writeFileSync(join(dir, '.trellis'), 'project: test\nchunk_max_lines: abc\n');

    const config = loadConfig(dir);
    expect(config.chunk_max_lines).toBeUndefined();
  });

  it('ignores negative chunk_max_lines', () => {
    const dir = createFixtureDir();
    writeFileSync(join(dir, '.trellis'), 'project: test\nchunk_max_lines: -100\n');

    const config = loadConfig(dir);
    expect(config.chunk_max_lines).toBeUndefined();
  });

  it('ignores chunk_max_lines: 0', () => {
    const dir = createFixtureDir();
    writeFileSync(join(dir, '.trellis'), 'project: test\nchunk_max_lines: 0\n');

    const config = loadConfig(dir);
    expect(config.chunk_max_lines).toBeUndefined();
  });
});
