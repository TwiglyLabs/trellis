import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureCacheDir, readCache, writeCache, isCacheStale } from './cache.ts';
import type { CacheEntry } from './types.ts';

function createProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'trellis-cache-'));
  mkdirSync(join(dir, '.trellis'), { recursive: true });
  return dir;
}

describe('ensureCacheDir', () => {
  it('creates .trellis/cache/ and returns the path', () => {
    const dir = createProjectDir();
    const result = ensureCacheDir(dir);
    expect(result).toBe(join(dir, '.trellis', 'cache'));
    expect(existsSync(result)).toBe(true);
  });

  it('is idempotent on repeated calls', () => {
    const dir = createProjectDir();
    ensureCacheDir(dir);
    ensureCacheDir(dir);
    expect(existsSync(join(dir, '.trellis', 'cache'))).toBe(true);
  });
});

describe('writeCache + readCache round-trip', () => {
  it('writes and reads back a CacheEntry', () => {
    const dir = createProjectDir();
    const data = { name: 'test', count: 42 };

    writeCache(dir, 'manifest', data);
    const entry = readCache<typeof data>(dir, 'manifest');

    expect(entry).not.toBeNull();
    expect(entry!.data).toEqual(data);
    expect(typeof entry!.fetchedAt).toBe('string');
    expect(new Date(entry!.fetchedAt).getTime()).toBeGreaterThan(0);
  });

  it('creates subdirectories for nested keys', () => {
    const dir = createProjectDir();
    const data = [{ id: 'plan-a', title: 'Plan A' }];

    writeCache(dir, 'plans/canopy', data);
    const entry = readCache<typeof data>(dir, 'plans/canopy');

    expect(entry).not.toBeNull();
    expect(entry!.data).toEqual(data);
    expect(existsSync(join(dir, '.trellis', 'cache', 'plans', 'canopy.json'))).toBe(true);
  });

  it('overwrites existing cache entry', () => {
    const dir = createProjectDir();

    writeCache(dir, 'manifest', { version: 1 });
    writeCache(dir, 'manifest', { version: 2 });

    const entry = readCache<{ version: number }>(dir, 'manifest');
    expect(entry!.data.version).toBe(2);
  });
});

describe('readCache', () => {
  it('returns null for missing cache file', () => {
    const dir = createProjectDir();
    expect(readCache(dir, 'nonexistent')).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    const dir = createProjectDir();
    mkdirSync(join(dir, '.trellis', 'cache'), { recursive: true });
    writeFileSync(join(dir, '.trellis', 'cache', 'bad.json'), 'not json{{{');

    expect(readCache(dir, 'bad')).toBeNull();
  });

  it('returns null for JSON missing fetchedAt', () => {
    const dir = createProjectDir();
    mkdirSync(join(dir, '.trellis', 'cache'), { recursive: true });
    writeFileSync(join(dir, '.trellis', 'cache', 'incomplete.json'), JSON.stringify({ data: 'hi' }));

    expect(readCache(dir, 'incomplete')).toBeNull();
  });

  it('returns null for JSON missing data field', () => {
    const dir = createProjectDir();
    mkdirSync(join(dir, '.trellis', 'cache'), { recursive: true });
    writeFileSync(
      join(dir, '.trellis', 'cache', 'nodata.json'),
      JSON.stringify({ fetchedAt: new Date().toISOString() }),
    );

    expect(readCache(dir, 'nodata')).toBeNull();
  });
});

describe('isCacheStale', () => {
  it('returns false for a fresh entry', () => {
    const entry: CacheEntry<string> = {
      data: 'hello',
      fetchedAt: new Date().toISOString(),
    };
    expect(isCacheStale(entry)).toBe(false);
  });

  it('returns true for an old entry', () => {
    const entry: CacheEntry<string> = {
      data: 'hello',
      fetchedAt: new Date(Date.now() - 600_000).toISOString(), // 10 min ago
    };
    expect(isCacheStale(entry)).toBe(true);
  });

  it('respects custom maxAgeMs', () => {
    const entry: CacheEntry<string> = {
      data: 'hello',
      fetchedAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
    };
    expect(isCacheStale(entry, 500)).toBe(true);   // 500ms max → stale
    expect(isCacheStale(entry, 5000)).toBe(false);  // 5s max → fresh
  });

  it('returns true for an entry with fetchedAt far in the past', () => {
    const entry: CacheEntry<string> = {
      data: 'old',
      fetchedAt: '2020-01-01T00:00:00.000Z',
    };
    expect(isCacheStale(entry)).toBe(true);
  });
});
