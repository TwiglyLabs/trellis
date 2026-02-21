import { describe, it, expect } from 'vitest';
import { createFileLock } from './mutex.ts';

describe('createFileLock', () => {
  it('returns a withLock function', () => {
    const withLock = createFileLock();
    expect(typeof withLock).toBe('function');
  });

  it('executes fn and returns its result', async () => {
    const withLock = createFileLock();
    const result = await withLock('key', () => 42);
    expect(result).toBe(42);
  });

  it('serializes calls on the same key', async () => {
    const withLock = createFileLock();
    const order: number[] = [];

    let resolveFirst!: () => void;
    const firstBlocked = new Promise<void>(r => { resolveFirst = r; });

    const p1 = withLock('same', async () => {
      order.push(1);
      await firstBlocked;
      order.push(2);
      return 'first';
    });

    const p2 = withLock('same', async () => {
      order.push(3);
      return 'second';
    });

    resolveFirst();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe('first');
    expect(r2).toBe('second');
    expect(order).toEqual([1, 2, 3]);
  });

  it('allows parallel calls on different keys', async () => {
    const withLock = createFileLock();
    const order: string[] = [];

    let resolveA!: () => void;
    const aBlocked = new Promise<void>(r => { resolveA = r; });

    const pA = withLock('key-a', async () => {
      order.push('a-start');
      await aBlocked;
      order.push('a-end');
    });

    const pB = withLock('key-b', async () => {
      order.push('b-start');
      order.push('b-end');
    });

    await pB;
    expect(order).toContain('b-start');
    expect(order).toContain('b-end');

    resolveA();
    await pA;
  });

  it('propagates errors without breaking the chain', async () => {
    const withLock = createFileLock();
    await expect(withLock('key', () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const result = await withLock('key', () => 'ok');
    expect(result).toBe('ok');
  });
});
