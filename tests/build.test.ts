import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

describe('library build', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: resolve(__dirname, '..') });
  });

  it('produces ESM and CJS library bundles', () => {
    expect(existsSync(resolve(__dirname, '../dist/index.mjs'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../dist/index.cjs'))).toBe(true);
  });

  it('ESM bundle exports expected symbols', async () => {
    const lib = await import(resolve(__dirname, '../dist/index.mjs'));
    expect(typeof lib.scanPlans).toBe('function');
    expect(typeof lib.buildGraph).toBe('function');
    expect(typeof lib.loadConfig).toBe('function');
    expect(typeof lib.filterPlans).toBe('function');
    expect(lib.VALID_STATUSES).toContain('done');
  });

  it('CJS bundle exports expected symbols', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lib = require(resolve(__dirname, '../dist/index.cjs'));
    expect(typeof lib.scanPlans).toBe('function');
    expect(typeof lib.buildGraph).toBe('function');
    expect(typeof lib.loadConfig).toBe('function');
    expect(typeof lib.filterPlans).toBe('function');
    expect(lib.VALID_STATUSES).toContain('done');
  });

  it('CLI binary still works', () => {
    expect(existsSync(resolve(__dirname, '../dist/trellis.cjs'))).toBe(true);
    const output = execSync('node dist/trellis.cjs --help', { cwd: resolve(__dirname, '..') }).toString();
    expect(output).toContain('trellis');
  });

  it('type declarations contain expected exports', () => {
    const dts = readFileSync(resolve(__dirname, '../dist/index.d.ts'), 'utf8');
    // Core types
    expect(dts).toContain('Plan');
    expect(dts).toContain('PlanStatus');
    expect(dts).toContain('TrellisConfig');
    // Functions
    expect(dts).toContain('scanPlans');
    expect(dts).toContain('buildGraph');
    expect(dts).toContain('loadConfig');
  });

  it('package.json exports point to existing files', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    expect(pkg.main).toBe('./dist/index.cjs');
    expect(pkg.module).toBe('./dist/index.mjs');
    expect(pkg.types).toBe('./dist/index.d.ts');
    expect(pkg.exports['.']).toBeDefined();
    expect(pkg.exports['.'].import).toBe('./dist/index.mjs');
    expect(pkg.exports['.'].require).toBe('./dist/index.cjs');
    expect(pkg.exports['.'].types).toBe('./dist/index.d.ts');
    // Verify all referenced files exist
    expect(existsSync(resolve(__dirname, '..', pkg.main))).toBe(true);
    expect(existsSync(resolve(__dirname, '..', pkg.module))).toBe(true);
    expect(existsSync(resolve(__dirname, '..', pkg.types))).toBe(true);
  });
});
