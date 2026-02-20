import * as esbuild from 'esbuild';
import { chmodSync } from 'fs';

await esbuild.build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/trellis.cjs',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [],
  minify: process.argv.includes('--minify'),
});

chmodSync('dist/trellis.cjs', 0o755);

// --- Library ESM build (no shebang, no viewer) ---
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.mjs',
  external: [],
  minify: process.argv.includes('--minify'),
});

// --- Library CJS build ---
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/index.cjs',
  external: [],
  minify: process.argv.includes('--minify'),
});
