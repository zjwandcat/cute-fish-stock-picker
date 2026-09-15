import { build } from 'esbuild';

await build({
  entryPoints: ['api/local.ts'],
  outfile: 'build/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  sourcemap: false,
  legalComments: 'linked',
});
