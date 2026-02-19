import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchCommand } from '../../src/commands/fetch.ts';
import { createFixture } from '../helpers.ts';

describe('fetch command', () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const origCwd = process.cwd;

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
  });

  afterEach(() => {
    process.cwd = origCwd;
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('prints no-manifest message when manifest is not configured', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);
    process.cwd = () => root;

    fetchCommand({});

    expect(errors.join('\n')).toContain('No manifest configured');
    expect(process.exitCode).toBe(1);
  });

  it('prints no-manifest message as JSON', () => {
    const { root } = createFixture([
      { id: 'a', title: 'Plan A', status: 'not_started' },
    ]);
    process.cwd = () => root;

    fetchCommand({ json: true });

    const output = JSON.parse(errors.join(''));
    expect(output.error).toContain('No manifest configured');
    expect(process.exitCode).toBe(1);
  });
});
