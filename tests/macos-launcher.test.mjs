import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildMacApp, macAppName } from '../scripts/build-macos-app.mjs';

test('native Mac window starts and quits its server', { skip: process.platform !== 'darwin', timeout: 150_000 }, async (t) => {
  const stage = await mkdtemp(join(tmpdir(), 'cute-fish-window-'));
  const payload = join(stage, macAppName, 'Contents/Resources/app');
  const runtime = join(payload, `runtime/darwin-${process.arch}/bin`);
  t.after(() => rm(stage, { recursive: true, force: true }));
  await mkdir(runtime, { recursive: true });
  await mkdir(join(payload, 'build'));
  await copyFile(process.execPath, join(runtime, 'node'));
  await chmod(join(runtime, 'node'), 0o755);
  await writeFile(join(payload, 'build/server.mjs'), `
    import { createServer } from 'node:http';
    const server = createServer((_req, res) => res.end('fixture'));
    server.listen(0, '127.0.0.1', () => console.log('Cute Fish Stock Picker: http://127.0.0.1:' + server.address().port));
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);
  await buildMacApp(stage, '0.3.0');
  const report = join(stage, 'gui.json');
  const child = spawn(join(stage, macAppName, 'Contents/MacOS/CuteFish'), ['--smoke-gui'], {
    cwd: tmpdir(), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, CUTE_FISH_GUI_TEST_REPORT: report, CUTE_FISH_NO_BROWSER: '1' },
  });
  let diagnostics = '';
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-8000); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, diagnostics);
    const result = JSON.parse(await readFile(report, 'utf8'));
    assert.equal(result.visible, true);
    assert.ok((await readFile(`${report}.png`)).length > 1000);
    await assert.rejects(fetch(result.url, { signal: AbortSignal.timeout(2000) }));
  } finally { clearTimeout(timer); }
});
