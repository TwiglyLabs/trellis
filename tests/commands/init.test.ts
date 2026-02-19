import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initCommand } from '../../src/commands/init.ts';

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

  it('creates .mcp.json alongside .trellis', async () => {
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

    expect(existsSync(join(dir, '.trellis'))).toBe(true);
    expect(errors.join('\n')).toContain('not valid JSON');
  });

  it('creates .mcp.json when .trellis already exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
    writeFileSync(join(dir, '.trellis'), 'project: test\nplans_dir: plans\n');
    mkdirSync(join(dir, 'plans'), { recursive: true });
    process.cwd = () => dir;

    await initCommand({ yes: true });

    expect(existsSync(join(dir, '.mcp.json'))).toBe(true);
    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.trellis).toBeDefined();
  });

  it('installs Claude Code hooks on fresh init', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
    process.cwd = () => dir;

    await initCommand({ yes: true });

    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(true);
    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks?.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Edit|Write');
  });

  it('installs Claude Code hooks when .trellis already exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-init-'));
    writeFileSync(join(dir, '.trellis'), 'project: test\nplans_dir: plans\n');
    mkdirSync(join(dir, 'plans'), { recursive: true });
    process.cwd = () => dir;

    await initCommand({ yes: true });

    expect(existsSync(join(dir, '.claude', 'hooks', 'protect-plans.sh'))).toBe(true);
    expect(logs.some(l => l.includes('Claude Code hooks'))).toBe(true);
  });
});
