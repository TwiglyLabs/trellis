/**
 * Per-key async mutex for serializing operations on shared resources.
 * Used by MCP server to prevent concurrent writes to the same plan.
 */
export function createFileLock(): <T>(key: string, fn: () => T | Promise<T>) => Promise<T> {
  const locks = new Map<string, Promise<void>>();

  return async function withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();

    let release: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    locks.set(key, gate);

    await prev;

    try {
      return await fn();
    } finally {
      release!();
      if (locks.get(key) === gate) {
        locks.delete(key);
      }
    }
  };
}
