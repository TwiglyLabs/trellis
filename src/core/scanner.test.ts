import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { derivePlanId, scanPlans, loadConfig } from './scanner.ts';

function createFixtureDir(): string {
  return mkdtempSync(join(tmpdir(), 'trellis-test-'));
}

function writePlan(dir: string, planPath: string, frontmatter: Record<string, any>, body = '') {
  const planDir = join(dir, planPath);
  mkdirSync(planDir, { recursive: true });

  const fm = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}:\n${v.map(i => `  - ${i}`).join('\n')}`;
      }
      return `${k}: ${v}`;
    })
    .join('\n');

  writeFileSync(join(planDir, 'README.md'), `---\n${fm}\n---\n${body}`);
}

describe('derivePlanId', () => {
  it('derives ID from directory plan README', () => {
    expect(derivePlanId('/plans/impl/core-extraction/README.md', '/plans')).toBe('impl/core-extraction');
  });

  it('derives ID from top-level directory plan', () => {
    expect(derivePlanId('/plans/quick-fix/README.md', '/plans')).toBe('quick-fix');
  });
});

describe('scanPlans', () => {
  it('discovers directory plans', () => {
    const dir = createFixtureDir();
    const plansDir = join(dir, 'plans');
    writePlan(dir, 'plans/a', { title: 'Plan A', status: 'draft' });
    writePlan(dir, 'plans/b', { title: 'Plan B', status: 'not_started' });

    const plans = scanPlans(plansDir);
    expect(plans).toHaveLength(2);
    expect(plans.map(p => p.id).sort()).toEqual(['a', 'b']);
  });

  it('discovers nested plans', () => {
    const dir = createFixtureDir();
    const plansDir = join(dir, 'plans');
    writePlan(dir, 'plans/contracts/core', { title: 'Core', status: 'draft' });
    writePlan(dir, 'plans/contracts/auth', { title: 'Auth', status: 'draft' });

    const plans = scanPlans(plansDir);
    expect(plans).toHaveLength(2);
    expect(plans.map(p => p.id).sort()).toEqual(['contracts/auth', 'contracts/core']);
  });

  it('discovers directory plans via README.md', () => {
    const dir = createFixtureDir();
    const plansDir = join(dir, 'plans');
    writePlan(dir, 'plans/impl/extraction', { title: 'Extraction', status: 'in_progress' });
    // sub-file.md should NOT be picked up as a separate plan
    writeFileSync(join(dir, 'plans/impl/extraction/sub-file.md'), '# Notes\nJust a sub-file.');

    const plans = scanPlans(plansDir);
    expect(plans).toHaveLength(1);
    expect(plans[0].id).toBe('impl/extraction');
  });

  it('ignores files without frontmatter', () => {
    const dir = createFixtureDir();
    const plansDir = join(dir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    // stray notes.md with no parent directory README.md — not a plan
    writeFileSync(join(plansDir, 'notes.md'), '# Just notes\nNo frontmatter here.');
    writePlan(dir, 'plans/real', { title: 'Real Plan', status: 'draft' });

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
    writePlan(dir, 'plans/test', { title: 'Test', status: 'draft' }, 'line1\nline2\nline3');

    const plans = scanPlans(plansDir);
    // frontmatter: ---\ntitle: Test\nstatus: draft\n---\nline1\nline2\nline3
    expect(plans[0].lineCount).toBe(7);
  });

  it('preserves frontmatter data', () => {
    const dir = createFixtureDir();
    const plansDir = join(dir, 'plans');
    writePlan(dir, 'plans/test', {
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

  it('parses manifest field from config', () => {
    const dir = createFixtureDir();
    writeFileSync(join(dir, '.trellis'), 'project: trellis\nplans_dir: plans\nmanifest: git@github.com:twiglylabs/twiglylabs.git\n');

    const config = loadConfig(dir);
    expect(config.manifest).toBe('git@github.com:twiglylabs/twiglylabs.git');
    expect(config.project).toBe('trellis');
    expect(config.plans_dir).toBe('plans');
  });

  it('returns undefined manifest when not in config', () => {
    const dir = createFixtureDir();
    writeFileSync(join(dir, '.trellis'), 'project: test\nplans_dir: plans\n');

    const config = loadConfig(dir);
    expect(config.manifest).toBeUndefined();
  });

  describe('directory format', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('reads .trellis/config when .trellis is a directory', () => {
      const dir = createFixtureDir();
      mkdirSync(join(dir, '.trellis'), { recursive: true });
      writeFileSync(join(dir, '.trellis', 'config'), 'project: acorn\nplans_dir: docs/plans\n');

      const config = loadConfig(dir);
      expect(config.project).toBe('acorn');
      expect(config.plans_dir).toBe('docs/plans');
    });

    it('returns defaults when .trellis dir exists but no config file', () => {
      const dir = createFixtureDir();
      mkdirSync(join(dir, '.trellis'), { recursive: true });

      const config = loadConfig(dir);
      expect(config.plans_dir).toBe('plans');
    });

    it('parses all fields from directory config', () => {
      const dir = createFixtureDir();
      mkdirSync(join(dir, '.trellis'), { recursive: true });
      writeFileSync(
        join(dir, '.trellis', 'config'),
        'project: trellis\nplans_dir: plans\nchunk_max_lines: 5000\nmanifest: git@github.com:org/repo.git\n',
      );

      const config = loadConfig(dir);
      expect(config.project).toBe('trellis');
      expect(config.chunk_max_lines).toBe(5000);
      expect(config.manifest).toBe('git@github.com:org/repo.git');
    });

    it('does not emit stderr hint for directory format', () => {
      const dir = createFixtureDir();
      mkdirSync(join(dir, '.trellis'), { recursive: true });
      writeFileSync(join(dir, '.trellis', 'config'), 'project: test\n');

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      loadConfig(dir);
      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  describe('file format upgrade hint', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('emits stderr hint when .trellis is a file', () => {
      const dir = createFixtureDir();
      writeFileSync(join(dir, '.trellis'), 'project: test\n');

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      loadConfig(dir);
      expect(stderrSpy).toHaveBeenCalledWith(
        'Tip: run `trellis init` to upgrade to directory format.\n',
      );
    });
  });
});
