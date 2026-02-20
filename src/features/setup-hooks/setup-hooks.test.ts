import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setupHooks } from './logic.ts';
import { setupHooksCommand } from './command.ts';

describe('setupHooks', () => {
  let originalCwd: () => string;

  beforeEach(() => {
    originalCwd = process.cwd;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
  });

  function makeProject(): string {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-hooks-'));
    writeFileSync(join(dir, '.trellis'), 'project: test\nplans_dir: plans\n');
    mkdirSync(join(dir, 'plans'), { recursive: true });
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
    return dir;
  }

  describe('Claude Code hooks', () => {
    it('creates .claude/settings.json with PreToolUse hook', () => {
      const dir = makeProject();
      const result = setupHooks(dir);

      expect(result.claudeHooks).toBe(true);
      const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
      expect(settings.hooks.PreToolUse).toHaveLength(1);
      expect(settings.hooks.PreToolUse[0].matcher).toBe('Edit|Write');
      expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain('protect-plans.sh');
    });

    it('creates the hook script file', () => {
      const dir = makeProject();
      setupHooks(dir);

      const hookPath = join(dir, '.claude', 'hooks', 'protect-plans.sh');
      expect(existsSync(hookPath)).toBe(true);

      const content = readFileSync(hookPath, 'utf8');
      expect(content).toContain('trellis MCP tools');
      expect(content).toContain('jq');

      // Check it's executable
      const stat = statSync(hookPath);
      expect(stat.mode & 0o111).toBeTruthy();
    });

    it('merges into existing .claude/settings.json', () => {
      const dir = makeProject();
      mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({
        permissions: { allow: ['WebSearch'] },
      }, null, 2));

      setupHooks(dir);

      const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
      expect(settings.permissions.allow).toContain('WebSearch');
      expect(settings.hooks.PreToolUse).toHaveLength(1);
    });

    it('preserves existing PreToolUse hooks with different matchers', () => {
      const dir = makeProject();
      mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'check-bash.sh' }] },
          ],
        },
      }, null, 2));

      setupHooks(dir);

      const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
      expect(settings.hooks.PreToolUse).toHaveLength(2);
      expect(settings.hooks.PreToolUse[0].matcher).toBe('Bash');
      expect(settings.hooks.PreToolUse[1].matcher).toBe('Edit|Write');
    });

    it('is idempotent — does not duplicate hooks', () => {
      const dir = makeProject();

      setupHooks(dir);
      const result2 = setupHooks(dir);

      expect(result2.claudeHooks).toBe(false);
      const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
      expect(settings.hooks.PreToolUse).toHaveLength(1);
    });

    it('reports already configured on second run', () => {
      const dir = makeProject();
      setupHooks(dir);
      const result2 = setupHooks(dir);

      expect(result2.messages).toContain('Claude Code hooks already configured');
    });
  });

  describe('git pre-commit hook', () => {
    it('creates pre-commit hook with trellis lint', () => {
      const dir = makeProject();
      const result = setupHooks(dir);

      expect(result.preCommit).toBe(true);
      const hook = readFileSync(join(dir, '.git', 'hooks', 'pre-commit'), 'utf8');
      expect(hook).toContain('trellis lint');
      expect(hook).toContain('#!/bin/bash');
    });

    it('makes pre-commit hook executable', () => {
      const dir = makeProject();
      setupHooks(dir);

      const stat = statSync(join(dir, '.git', 'hooks', 'pre-commit'));
      expect(stat.mode & 0o111).toBeTruthy();
    });

    it('appends to existing pre-commit hook', () => {
      const dir = makeProject();
      writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/bash\necho "existing hook"\n');

      setupHooks(dir);

      const hook = readFileSync(join(dir, '.git', 'hooks', 'pre-commit'), 'utf8');
      expect(hook).toContain('existing hook');
      expect(hook).toContain('trellis lint');
    });

    it('is idempotent — does not duplicate trellis lint', () => {
      const dir = makeProject();

      setupHooks(dir);
      const hook1 = readFileSync(join(dir, '.git', 'hooks', 'pre-commit'), 'utf8');

      const result2 = setupHooks(dir);
      const hook2 = readFileSync(join(dir, '.git', 'hooks', 'pre-commit'), 'utf8');

      expect(result2.preCommit).toBe(false);
      expect(hook2).toBe(hook1);
    });

    it('skips when not a git repo', () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-hooks-'));
      writeFileSync(join(dir, '.trellis'), 'project: test\nplans_dir: plans\n');

      const result = setupHooks(dir);

      expect(result.preCommit).toBe(false);
      expect(result.messages.some(m => m.includes('Not a git repository'))).toBe(true);
    });
  });

  describe('setupHooksCommand', () => {
    it('prints messages to console', () => {
      const dir = makeProject();
      process.cwd = () => dir;
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: any[]) => logs.push(args.join(' ')));

      setupHooksCommand();

      expect(logs.some(l => l.includes('Claude Code hooks'))).toBe(true);
      expect(logs.some(l => l.includes('pre-commit'))).toBe(true);
    });

    it('shows nothing-to-do when already installed', () => {
      const dir = makeProject();
      process.cwd = () => dir;
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: any[]) => logs.push(args.join(' ')));

      setupHooksCommand();
      logs.length = 0;
      setupHooksCommand();

      expect(logs.some(l => l.includes('nothing to do'))).toBe(true);
    });
  });
});
