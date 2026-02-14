import * as esbuild from 'esbuild';
import { readFileSync, chmodSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Plugin to bundle dagre as IIFE and inject into HTML
const dagreInjectionPlugin = {
  name: 'dagre-injection',
  setup(build) {
    build.onLoad({ filter: /viewer\/index\.html$/ }, async (args) => {
      // Bundle dagre as IIFE
      const dagreResult = await esbuild.build({
        entryPoints: [resolve(__dirname, 'src/viewer/dagre-shim.ts')],
        bundle: true,
        format: 'iife',
        globalName: 'dagre',
        write: false,
        minify: true,
      });
      const dagreCode = dagreResult.outputFiles[0].text;

      // Read HTML and inject dagre
      let html = readFileSync(args.path, 'utf8');
      html = html.replace('/* __DAGRE_BUNDLE__ */', dagreCode);

      return {
        contents: `export default ${JSON.stringify(html)};`,
        loader: 'js',
      };
    });
  },
};

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
  plugins: [dagreInjectionPlugin],
  external: [],
  minify: process.argv.includes('--minify'),
});

chmodSync('dist/trellis.cjs', 0o755);
