import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { detectPlatform, downloads } from '../public/download-platform.js';

test('download selection covers Windows 10/11, Macs and mobile browsers', () => {
  assert.equal(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'macos');
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'other');
  assert.equal(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'other');
  assert.equal(detectPlatform('Mozilla/5.0 (Linux; Android 14)'), 'other');
  assert.equal(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)'), 'other');
  assert.ok(downloads.windows.url.endsWith('/cute-fish-stock-picker-windows.zip'));
  assert.ok(downloads.macos.url.endsWith('/cute-fish-stock-picker-macos.zip'));
});

async function exerciseServer(t, executable, entry, cwd, launcher) {
  // A local proxy isolates the launch tests from paid Tushare requests.
  const proxy = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 0, data: { fields: [], items: [] } }));
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const temporary = await mkdtemp(join(tmpdir(), 'cute-fish-测试 & space-'));
  const env = {
    ...process.env,
    CUTE_FISH_DATA_DIR: join(temporary, '用户数据'),
    CUTE_FISH_NO_BROWSER: '1',
    CUTE_FISH_MONTHLY_AUTO: '0',
    TUSHARE_TOKEN: '',
    HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`,
    HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`,
    NO_PROXY: '127.0.0.1,localhost',
  };
  const processes = new Set();
  async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    processes.delete(child);
  }
  t.after(async () => {
    await Promise.all([...processes].map(stop));
    proxy.closeAllConnections();
    proxy.close();
    assert.ok(resolve(temporary).startsWith(`${resolve(tmpdir())}${sep}`));
    await rm(temporary, { recursive: true, force: true });
  });
  async function start(port = '0') {
    const child = spawn(executable, [entry], { cwd, env: { ...env, PORT: port }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    processes.add(child);
    let output = '';
    const url = await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 15_000);
      child.once('error', reject);
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
      child.stdout.on('data', (data) => {
        output += data;
        const match = output.match(/Cute Fish Stock Picker: (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); accept(match[1]); }
      });
      child.stderr.on('data', (data) => { output += data; });
    });
    return { child, url, logs: () => output };
  }
  const instance = await start();
  const request = (path, init) => fetch(`${instance.url}${path}`, init);
  assert.equal((await request('/', { redirect: 'manual' })).headers.get('location'), '/setup');
  assert.match(await (await request('/setup')).text(), /Tushare Token/);
  assert.equal((await request('/api/stocks')).status, 503);
  assert.equal((await request('/api/local/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"token":"short"}' })).status, 400);
  assert.equal((await request('/api/local/config', { headers: { Origin: 'https://example.com' } })).status, 403);
  const foreignHostStatus = await new Promise((accept, reject) => {
    httpRequest(`${instance.url}/api/local/config`, { headers: { Host: 'example.com' } }, (res) => {
      res.resume();
      accept(res.statusCode);
    }).on('error', reject).end();
  });
  assert.equal(foreignHostStatus, 403);
  const token = 'test_token_' + 'a'.repeat(40);
  const saved = await request('/api/local/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: instance.url }, body: JSON.stringify({ token }) });
  assert.equal(saved.status, 200);
  assert.deepEqual(await (await request('/api/local/config')).json(), { success: true, configured: true });
  assert.ok(!(await (await request('/api/local/config')).text()).includes(token));
  const index = await (await request('/')).text();
  assert.match(index, /可爱鱼儿选股指南/);
  const asset = index.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
  assert.equal((await request(asset)).status, 200);
  assert.equal((await request('/download.html')).status, 200);
  assert.equal((await request('/config.json')).status, 404);
  assert.equal((await request('/api/unknown')).status, 404);
  const holding = { ts_code: '000001.SZ', name: '测试持仓', shares: 100, buy_price: 10 };
  const holdings = await (await request('/api/holdings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', holding }) })).json();
  assert.equal(holdings.success, true);
  assert.equal(holdings.holdings[0].ts_code, holding.ts_code);
  const settings = await (await request('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ macdv: { strong: 40, extreme: 120 } }) })).json();
  assert.equal(settings.success, true);
  assert.ok(!instance.logs().includes(token));
  await stop(instance.child);
  const restarted = await start();
  assert.equal((await (await fetch(`${restarted.url}/api/local/config`)).json()).configured, true);
  assert.equal((await (await fetch(`${restarted.url}/api/holdings`)).json()).holdings[0].ts_code, holding.ts_code);
  const busyPort = String(proxy.address().port);
  const collision = await start(busyPort);
  assert.notEqual(new URL(collision.url).port, busyPort);
  await stop(collision.child);
  const duplicate = spawn(executable, [entry], { cwd, env: { ...env, PORT: new URL(restarted.url).port }, windowsHide: true, stdio: 'ignore' });
  processes.add(duplicate);
  const [code] = await once(duplicate, 'exit');
  assert.equal(code, 0);
  assert.equal((await fetch(`${restarted.url}/api/health`)).status, 200);
  if (launcher) {
    // Execute the real double-click entry against the running instance. It must
    // find its bundled runtime even when Node.js/npm are absent from PATH.
    const path = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin';
    const launcherEnv = { ...env, PATH: path, Path: path, PORT: new URL(restarted.url).port };
    const launch = process.platform === 'win32'
      ? spawn(process.env.ComSpec, ['/d', '/s', '/c', `""${launcher}""`], { cwd, env: launcherEnv, windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' })
      : spawn(launcher, [], { cwd, env: launcherEnv, stdio: 'ignore' });
    processes.add(launch);
    const [exitCode] = await once(launch, 'exit');
    assert.equal(exitCode, 0);
    assert.equal((await fetch(`${restarted.url}/api/health`)).status, 200);
  }
  await stop(restarted.child);
}

test('production bundle supports clean setup, persistence, local access and port conflicts', { timeout: 60_000 }, async (t) => {
  await exerciseServer(t, process.execPath, resolve('build/server.mjs'), tmpdir());
});

test('native release ZIP runs without system Node.js or node_modules', { timeout: 120_000 }, async (t) => {
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : '';
  if (!platform) { t.skip('Native archive test runs on Windows and macOS'); return; }
  const archive = resolve(`release/cute-fish-stock-picker-${platform}.zip`);
  if (!await stat(archive).catch(() => null)) { t.skip('Build the native release ZIP to run this test'); return; }
  const extraction = await mkdtemp(join(tmpdir(), 'cute-fish-解压 & space-'));
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const extracted = platform === 'windows'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(extraction)}`], { windowsHide: true, encoding: 'utf8' })
    : spawnSync('ditto', ['-x', '-k', archive, extraction], { encoding: 'utf8' });
  assert.equal(extracted.status, 0, extracted.stderr);
  const root = join(extraction, `cute-fish-stock-picker-${platform}`);
  assert.ok(!(await readdir(root)).some(file => ['.env', 'api', 'node_modules'].includes(file)));
  const launcher = join(root, platform === 'windows' ? '启动选股指南.bat' : '启动选股指南.command');
  assert.ok((await readFile(launcher, 'utf8')).includes('build'));
  if (platform === 'macos') assert.ok((await stat(launcher)).mode & 0o111);
  const runtime = platform === 'windows' ? join(root, 'runtime/win-x64/node.exe') : join(root, `runtime/darwin-${process.arch}/bin/node`);
  try {
    await exerciseServer(t, runtime, join(root, 'build/server.mjs'), root, launcher);
  } finally {
    t.after(async () => {
      assert.ok(resolve(extraction).startsWith(`${resolve(tmpdir())}${sep}`));
      await rm(extraction, { recursive: true, force: true });
    });
  }
});
