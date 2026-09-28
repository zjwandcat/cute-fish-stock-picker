import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = await mkdtemp(resolve(tmpdir(), 'cute-fish-runtime-check-'));
const harness = new DeepSeekHarness({
  cwd: home,
  processCwd: home,
  dshHome: home,
  dshBin: resolve(root, 'ai-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'),
  profile: 'sdk-minimal',
  patches: [resolve(root, 'ai-runtime/fish-finance.cordis.yml')],
  env: {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: home,
    USERPROFILE: home,
    DSH_TELEMETRY_DISABLED: '1',
    DEEPSEEK_API_KEY: 'offline-startup-fixture',
    DEEPSEEK_BASE_URL: 'http://127.0.0.1:1',
  },
  initializeTimeoutMs: 60_000,
});
try {
  await harness.start();
  console.log('Bundled AI runtime: startup OK (no model request)');
} finally {
  await harness.close();
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
