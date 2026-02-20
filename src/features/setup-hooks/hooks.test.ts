import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { setupHooks } from './logic.ts';

const HOOK_SCRIPT = join(__dirname, '..', '..', '..', '.claude', 'hooks', 'protect-plans.sh');

function runHook(input: Record<string, any>, env?: Record<string, string>): { exitCode: number; stderr: string } {
  try {
    const result = execFileSync('bash', [HOOK_SCRIPT], {
      input: JSON.stringify(input),
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 5000,
    });
    return { exitCode: 0, stderr: '' };
  } catch (err: any) {
    return { exitCode: err.status ?? 1, stderr: err.stderr ?? '' };
  }
}

describe('protect-plans hook', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'trellis-hook-'));
    writeFileSync(join(root, '.trellis'), 'project: test\nplans_dir: plans\n');
    mkdirSync(join(root, 'plans', 'my-plan'), { recursive: true });
    writeFileSync(join(root, 'plans', 'my-plan', 'README.md'), '---\ntitle: Test\nstatus: draft\n---\n');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'index.ts'), 'console.log("hi");\n');
  });

  it('blocks Edit on files inside plans/', () => {
    const result = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'plans', 'my-plan', 'README.md') },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('trellis MCP tools');
    expect(result.stderr).toContain('Edit');
  });

  it('blocks Write on files inside plans/', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: join(root, 'plans', 'my-plan', 'README.md') },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('trellis MCP tools');
    expect(result.stderr).toContain('Write');
  });

  it('allows Edit on files outside plans/', () => {
    const result = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src', 'index.ts') },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows Write on files outside plans/', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: join(root, 'src', 'index.ts') },
    });
    expect(result.exitCode).toBe(0);
  });

  it('resolves plans_dir from .trellis config', () => {
    // Change plans_dir to custom location
    writeFileSync(join(root, '.trellis'), 'project: test\nplans_dir: my-plans\n');
    mkdirSync(join(root, 'my-plans', 'some-plan'), { recursive: true });
    writeFileSync(join(root, 'my-plans', 'some-plan', 'README.md'), '---\ntitle: Test\nstatus: draft\n---\n');

    const result = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'my-plans', 'some-plan', 'README.md') },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('trellis MCP tools');
  });

  it('allows edits to default plans/ when plans_dir is custom', () => {
    writeFileSync(join(root, '.trellis'), 'project: test\nplans_dir: my-plans\n');
    mkdirSync(join(root, 'my-plans'), { recursive: true });

    // plans/ should not be protected when plans_dir is my-plans
    const result = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'plans', 'my-plan', 'README.md') },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows operations when no .trellis config exists', () => {
    const noTrellis = mkdtempSync(join(tmpdir(), 'trellis-hook-'));
    mkdirSync(join(noTrellis, 'plans'), { recursive: true });
    writeFileSync(join(noTrellis, 'plans', 'test.md'), 'hi');

    const result = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: join(noTrellis, 'plans', 'test.md') },
    });
    expect(result.exitCode).toBe(0);
  });

  it('handles empty file_path gracefully', () => {
    const result = runHook({
      tool_name: 'Edit',
      tool_input: {},
    });
    expect(result.exitCode).toBe(0);
  });

  it('blocks writes to nested plan files (implementation.md)', () => {
    writeFileSync(join(root, 'plans', 'my-plan', 'implementation.md'), '## Steps\n');

    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: join(root, 'plans', 'my-plan', 'implementation.md') },
    });
    expect(result.exitCode).toBe(2);
  });

  it('uses CLAUDE_PROJECT_DIR as fallback when find_project_root fails', () => {
    // Create the actual project with .trellis
    const project = mkdtempSync(join(tmpdir(), 'trellis-project-'));
    writeFileSync(join(project, '.trellis'), 'project: test\nplans_dir: plans\n');
    mkdirSync(join(project, 'plans', 'test-plan'), { recursive: true });
    writeFileSync(join(project, 'plans', 'test-plan', 'README.md'), 'test');

    // Create a separate tree with a symlink into the project's plans.
    // find_project_root walks dirname() up from the symlink path — it won't
    // find .trellis because 'outside/' has no .trellis. The CLAUDE_PROJECT_DIR
    // fallback resolves it, and pwd -P resolves the symlink for the match.
    const outside = mkdtempSync(join(tmpdir(), 'trellis-outside-'));
    symlinkSync(join(project, 'plans'), join(outside, 'plans'), 'dir');

    const result = runHook(
      {
        tool_name: 'Edit',
        tool_input: { file_path: join(outside, 'plans', 'test-plan', 'README.md') },
      },
      { CLAUDE_PROJECT_DIR: project },
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('trellis MCP tools');
  });

  it('error message lists specific MCP tool names', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: join(root, 'plans', 'my-plan', 'README.md') },
    });
    expect(result.stderr).toContain('trellis_create');
    expect(result.stderr).toContain('trellis_write_section');
    expect(result.stderr).toContain('trellis_read_section');
    expect(result.stderr).toContain('trellis_set');
    expect(result.stderr).toContain('trellis_update');
  });

  it('strips inline comments from plans_dir config', () => {
    writeFileSync(join(root, '.trellis'), 'project: test\nplans_dir: plans # the default\n');

    const result = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'plans', 'my-plan', 'README.md') },
    });
    expect(result.exitCode).toBe(2);
  });
});

// e2e tests use the locally built dist/trellis.cjs via a PATH override,
// so we're always testing the current code, not whatever's installed globally.
const TRELLIS_CJS = join(__dirname, '..', '..', '..', 'dist', 'trellis.cjs');

describe('pre-commit hook e2e', () => {
  let testEnvPath: string;

  beforeAll(() => {
    // Create a bin dir with a `trellis` wrapper pointing at the built bundle
    const binDir = mkdtempSync(join(tmpdir(), 'trellis-bin-'));
    writeFileSync(
      join(binDir, 'trellis'),
      `#!/usr/bin/env bash\nexec node "${TRELLIS_CJS}" "$@"\n`,
    );
    chmodSync(join(binDir, 'trellis'), 0o755);
    testEnvPath = `${binDir}:${process.env.PATH}`;
  });

  function makeGitRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-precommit-'));
    execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
    writeFileSync(join(dir, '.trellis'), 'project: test\nplans_dir: plans\n');
    mkdirSync(join(dir, 'plans'), { recursive: true });
    setupHooks(dir);
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init', '--no-verify'], { cwd: dir, stdio: 'pipe' });
    return dir;
  }

  function gitCommit(dir: string, message = 'test'): { exitCode: number; stderr: string } {
    try {
      execFileSync('git', ['commit', '-m', message], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, PATH: testEnvPath },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { exitCode: 0, stderr: '' };
    } catch (err: any) {
      return { exitCode: err.status ?? 1, stderr: err.stderr ?? '' };
    }
  }

  it('allows commit when staged plans are valid', () => {
    const dir = makeGitRepo();
    mkdirSync(join(dir, 'plans', 'valid-plan'), { recursive: true });
    writeFileSync(
      join(dir, 'plans', 'valid-plan', 'README.md'),
      '---\ntitle: Valid Plan\nstatus: draft\n---\n## Problem\nSomething to solve\n',
    );
    execFileSync('git', ['add', 'plans/'], { cwd: dir, stdio: 'pipe' });

    const result = gitCommit(dir);
    expect(result.exitCode).toBe(0);
  });

  it('rejects commit when plans have lint errors', () => {
    const dir = makeGitRepo();
    mkdirSync(join(dir, 'plans', 'broken-plan'), { recursive: true });
    writeFileSync(
      join(dir, 'plans', 'broken-plan', 'README.md'),
      '---\ntitle: Broken\nstatus: draft\ndepends_on:\n  - nonexistent-plan\n---\n## Problem\nBroken dep\n',
    );
    execFileSync('git', ['add', 'plans/'], { cwd: dir, stdio: 'pipe' });

    const result = gitCommit(dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('trellis lint');
  });

  it('skips lint when no plan files are staged', () => {
    const dir = makeGitRepo();
    // Invalid plan exists in working tree but is NOT staged
    mkdirSync(join(dir, 'plans', 'broken-plan'), { recursive: true });
    writeFileSync(
      join(dir, 'plans', 'broken-plan', 'README.md'),
      '---\ntitle: Broken\nstatus: draft\ndepends_on:\n  - ghost\n---\n',
    );
    // Stage only a non-plan file
    writeFileSync(join(dir, 'app.ts'), 'console.log("hello");\n');
    execFileSync('git', ['add', 'app.ts'], { cwd: dir, stdio: 'pipe' });

    const result = gitCommit(dir);
    expect(result.exitCode).toBe(0);
  });

  it('rejects commit when plan has cycle', () => {
    const dir = makeGitRepo();
    mkdirSync(join(dir, 'plans', 'plan-a'), { recursive: true });
    writeFileSync(
      join(dir, 'plans', 'plan-a', 'README.md'),
      '---\ntitle: A\nstatus: draft\ndepends_on:\n  - plan-b\n---\n## Problem\nCycle\n',
    );
    mkdirSync(join(dir, 'plans', 'plan-b'), { recursive: true });
    writeFileSync(
      join(dir, 'plans', 'plan-b', 'README.md'),
      '---\ntitle: B\nstatus: draft\ndepends_on:\n  - plan-a\n---\n## Problem\nCycle\n',
    );
    execFileSync('git', ['add', 'plans/'], { cwd: dir, stdio: 'pipe' });

    const result = gitCommit(dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('trellis lint');
  });
});
