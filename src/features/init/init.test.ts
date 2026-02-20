import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initCommand } from './command.ts';

describe('initCommand', () => {
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

  describe('fresh init (directory format)', () => {
    it('creates .trellis/ directory with config and .gitignore', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      process.cwd = () => dir;

      await initCommand({ yes: true });

      expect(statSync(join(dir, '.trellis')).isDirectory()).toBe(true);
      expect(existsSync(join(dir, '.trellis', 'config'))).toBe(true);
      expect(existsSync(join(dir, '.trellis', '.gitignore'))).toBe(true);

      const config = readFileSync(join(dir, '.trellis', 'config'), 'utf8');
      expect(config).toContain('plans_dir: plans');

      const gitignore = readFileSync(join(dir, '.trellis', '.gitignore'), 'utf8');
      expect(gitignore).toContain('cache/');
    });

    it('creates plans/ directory', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      process.cwd = () => dir;

      await initCommand({ yes: true });

      expect(existsSync(join(dir, 'plans'))).toBe(true);
    });

    it('creates .mcp.json', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      process.cwd = () => dir;

      await initCommand({ yes: true });

      expect(existsSync(join(dir, '.mcp.json'))).toBe(true);
      const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
      expect(mcp.mcpServers.trellis).toEqual({
        type: 'stdio',
        command: 'trellis',
        args: ['mcp'],
      });
    });

    it('installs Claude Code hooks', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      process.cwd = () => dir;

      await initCommand({ yes: true });

      expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(true);
      const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
      expect(settings.hooks?.PreToolUse).toHaveLength(1);
      expect(settings.hooks.PreToolUse[0].matcher).toBe('Edit|Write');
    });
  });

  describe('migration from file format', () => {
    it('migrates .trellis file to .trellis/config with --yes', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      writeFileSync(join(dir, '.trellis'), 'project: acorn\nplans_dir: docs/plans\n');
      mkdirSync(join(dir, 'docs/plans'), { recursive: true });
      process.cwd = () => dir;

      await initCommand({ yes: true });

      expect(statSync(join(dir, '.trellis')).isDirectory()).toBe(true);
      const config = readFileSync(join(dir, '.trellis', 'config'), 'utf8');
      expect(config).toBe('project: acorn\nplans_dir: docs/plans\n');
      expect(existsSync(join(dir, '.trellis', '.gitignore'))).toBe(true);
      expect(logs.join('\n')).toContain('Migrated');
    });

    it('preserves all config values during migration', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      const content = 'project: trellis\nplans_dir: plans\nmanifest: git@github.com:org/repo.git\nchunk_max_lines: 5000\n';
      writeFileSync(join(dir, '.trellis'), content);
      mkdirSync(join(dir, 'plans'), { recursive: true });
      process.cwd = () => dir;

      await initCommand({ yes: true });

      const config = readFileSync(join(dir, '.trellis', 'config'), 'utf8');
      expect(config).toBe(content);
    });

    it('creates .gitignore with cache/ during migration', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      writeFileSync(join(dir, '.trellis'), 'project: test\nplans_dir: plans\n');
      mkdirSync(join(dir, 'plans'), { recursive: true });
      process.cwd = () => dir;

      await initCommand({ yes: true });

      const gitignore = readFileSync(join(dir, '.trellis', '.gitignore'), 'utf8');
      expect(gitignore).toContain('cache/');
    });
  });

  describe('idempotent on directory format', () => {
    it('logs already exists when .trellis is a directory', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      mkdirSync(join(dir, '.trellis'), { recursive: true });
      writeFileSync(join(dir, '.trellis', 'config'), 'project: test\nplans_dir: plans\n');
      process.cwd = () => dir;

      await initCommand({ yes: true });

      expect(logs.join('\n')).toContain('.trellis/ already exists');
    });

    it('does not corrupt existing directory config', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      mkdirSync(join(dir, '.trellis'), { recursive: true });
      const content = 'project: acorn\nplans_dir: docs/plans\n';
      writeFileSync(join(dir, '.trellis', 'config'), content);
      process.cwd = () => dir;

      await initCommand({ yes: true });

      expect(readFileSync(join(dir, '.trellis', 'config'), 'utf8')).toBe(content);
    });

    it('still sets up .mcp.json and hooks when already migrated', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      mkdirSync(join(dir, '.trellis'), { recursive: true });
      writeFileSync(join(dir, '.trellis', 'config'), 'project: test\nplans_dir: plans\n');
      process.cwd = () => dir;

      await initCommand({ yes: true });

      expect(existsSync(join(dir, '.mcp.json'))).toBe(true);
      expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(true);
    });
  });

  describe('.mcp.json handling', () => {
    it('merges into existing .mcp.json without clobbering', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
        mcpServers: {
          other: { type: 'stdio', command: 'other', args: [] },
        },
      }, null, 2));
      process.cwd = () => dir;

      await initCommand({ yes: true });

      const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
      expect(mcp.mcpServers.other).toBeDefined();
      expect(mcp.mcpServers.trellis).toBeDefined();
    });

    it('does not overwrite existing trellis config in .mcp.json', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
        mcpServers: {
          trellis: { type: 'stdio', command: 'custom-trellis', args: ['mcp'] },
        },
      }, null, 2));
      process.cwd = () => dir;

      await initCommand({ yes: true });

      const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
      expect(mcp.mcpServers.trellis.command).toBe('custom-trellis');
      expect(logs.join('\n')).toContain('already has trellis');
    });

    it('handles invalid .mcp.json gracefully', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      writeFileSync(join(dir, '.mcp.json'), 'not json');
      process.cwd = () => dir;

      await initCommand({ yes: true });

      expect(statSync(join(dir, '.trellis')).isDirectory()).toBe(true);
      expect(errors.join('\n')).toContain('not valid JSON');
    });

    it('creates .mcp.json when running init on existing directory', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
      mkdirSync(join(dir, '.trellis'), { recursive: true });
      writeFileSync(join(dir, '.trellis', 'config'), 'project: test\nplans_dir: plans\n');
      process.cwd = () => dir;

      await initCommand({ yes: true });

      expect(existsSync(join(dir, '.mcp.json'))).toBe(true);
      const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
      expect(mcp.mcpServers.trellis).toBeDefined();
    });
  });
});
