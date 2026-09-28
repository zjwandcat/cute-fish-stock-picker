import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { createWindowsArchive, extractWindowsArchive } from '../scripts/windows-archive.mjs';

test('Windows ZIP preserves Chinese names, hidden files and quoted paths', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cute-fish-中文 & 'zip-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, '中文应用');
  await mkdir(join(source, '.hidden'), { recursive: true });
  await writeFile(join(source, '启动选股指南.bat'), 'fixture-launcher');
  await writeFile(join(source, '.hidden/config'), 'fixture-hidden');
  const archive = join(root, '下载.zip');
  const destination = join(root, '解压');
  createWindowsArchive(source, archive);
  extractWindowsArchive(archive, destination);
  assert.equal(await readFile(join(destination, basename(source), '启动选股指南.bat'), 'utf8'), 'fixture-launcher');
  assert.equal(await readFile(join(destination, basename(source), '.hidden/config'), 'utf8'), 'fixture-hidden');
});
