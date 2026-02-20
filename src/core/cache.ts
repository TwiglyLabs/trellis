import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import type { CacheEntry } from './types.ts';

const DEFAULT_MAX_AGE_MS = 300_000; // 5 minutes

/** Create .trellis/cache/ if it doesn't exist, return the path. */
export function ensureCacheDir(projectDir: string): string {
  const cacheDir = join(projectDir, '.trellis', 'cache');
  mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

/** Read a cache entry from .trellis/cache/<key>.json. Returns null if missing or corrupt. */
export function readCache<T>(projectDir: string, key: string): CacheEntry<T> | null {
  const filePath = join(projectDir, '.trellis', 'cache', `${key}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.fetchedAt === 'string' && 'data' in parsed) {
      return parsed as CacheEntry<T>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Write data wrapped in a CacheEntry to .trellis/cache/<key>.json. */
export function writeCache<T>(projectDir: string, key: string, data: T): void {
  const filePath = join(projectDir, '.trellis', 'cache', `${key}.json`);
  mkdirSync(dirname(filePath), { recursive: true });
  const entry: CacheEntry<T> = {
    data,
    fetchedAt: new Date().toISOString(),
  };
  writeFileSync(filePath, JSON.stringify(entry, null, 2) + '\n');
}

/** Check if a cache entry is stale. Pure function — no filesystem access. */
export function isCacheStale<T>(entry: CacheEntry<T>, maxAgeMs: number = DEFAULT_MAX_AGE_MS): boolean {
  const fetchedAt = new Date(entry.fetchedAt).getTime();
  return Date.now() - fetchedAt > maxAgeMs;
}
