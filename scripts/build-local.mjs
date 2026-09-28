import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('build', { recursive: true });
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

await build({
  entryPoints: ['scripts/verify-ai-runtime.mjs'],
  outfile: 'build/verify-ai-runtime.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: 'inline',
});
