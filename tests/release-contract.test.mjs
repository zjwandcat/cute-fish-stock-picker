import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { macAppName } from '../scripts/build-macos-app.mjs';

test('release versions and public entry points stay aligned', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  assert.equal(pkg.version, lock.version);
  assert.equal(pkg.version, lock.packages[''].version);
  const page = await readFile('public/download.html', 'utf8');
  assert.ok(page.includes(macAppName));
  assert.ok(page.includes('Apple Developer ID'));
  assert.ok(page.includes('Python'));
  for (const platform of ['macos', 'windows']) assert.ok(page.includes(`cute-fish-stock-picker-${platform}.zip`));
});

test('macOS app keeps mutable Python state outside the application bundle', async () => {
  const setup = await readFile('scripts/setup-monthly.py', 'utf8');
  const service = await readFile('api/services/monthlyRecommendations.ts', 'utf8');
  assert.match(setup, /Library\/Application Support\/Cute Fish Stock Picker/);
  assert.ok(service.includes("dataFile('monthly-venv/bin/python')"));
  const launcher = await readFile('启动选股指南.command', 'utf8');
  assert.ok(launcher.includes(`./${macAppName}/Contents/MacOS/CuteFish`));
});
