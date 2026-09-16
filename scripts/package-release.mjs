import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const platform = process.argv[2];
if (!['windows', 'macos'].includes(platform)) throw new Error('Usage: npm run package -- windows|macos');
if ((platform === 'windows' && process.platform !== 'win32') || (platform === 'macos' && process.platform !== 'darwin')) {
  throw new Error('Build each archive on its native OS to preserve launcher and runtime permissions.');
}
const nodeVersion = 'v22.23.2';
const root = process.cwd();
const output = resolve(root, 'release');
const stage = resolve(output, `cute-fish-stock-picker-${platform}`);
if (!stage.startsWith(`${output}${sep}`)) throw new Error('Invalid staging directory');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
const cache = resolve('.release-cache', nodeVersion);
await mkdir(cache, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
async function checksum(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function getResponse(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  return response;
}
const sums = await (await getResponse(`https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`)).text();
const targets = platform === 'windows' ? ['win-x64'] : ['darwin-arm64', 'darwin-x64'];
for (const target of targets) {
  const name = `node-${nodeVersion}-${target}`;
  const archiveName = `${name}.${platform === 'windows' ? 'zip' : 'tar.gz'}`;
  const expected = sums.split('\n').find(line => line.trim().endsWith(` ${archiveName}`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`Missing official checksum for ${archiveName}`);
  const archive = join(cache, archiveName);
  if (await checksum(archive).catch(() => '') !== expected) {
    console.log(`Downloading ${archiveName}`);
    const response = await getResponse(`https://nodejs.org/dist/${nodeVersion}/${archiveName}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  }
  if (await checksum(archive) !== expected) throw new Error(`Checksum mismatch: ${archiveName}`);
  if (platform === 'windows') {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(cache)} -Force`]);
  } else {
    run('tar', ['-xzf', archive, '-C', cache]);
  }
  const runtime = join(stage, 'runtime', target);
  const nodeName = platform === 'windows' ? 'node.exe' : 'bin/node';
  await mkdir(platform === 'windows' ? runtime : join(runtime, 'bin'), { recursive: true });
  await copyFile(join(cache, name, nodeName), join(runtime, nodeName));
  await copyFile(join(cache, name, 'LICENSE'), join(runtime, 'LICENSE'));
  if (platform === 'macos') await chmod(join(runtime, nodeName), 0o755);
}

// Allowlist package contents: never copy .env, api/data, source checkouts or node_modules.
await cp(join(root, 'dist'), join(stage, 'dist'), { recursive: true });
await mkdir(join(stage, 'build'));
await copyFile(join(root, 'build/server.mjs'), join(stage, 'build/server.mjs'));
await copyFile(join(root, 'build/server.mjs.LEGAL.txt'), join(stage, 'build/server.mjs.LEGAL.txt'));
await copyFile(join(root, 'monthly_recommendation_runner.py'), join(stage, 'monthly_recommendation_runner.py'));
await copyFile(join(root, 'monthly_runtime.py'), join(stage, 'monthly_runtime.py'));
await copyFile(join(root, 'monthly_data.py'), join(stage, 'monthly_data.py'));
await copyFile(join(root, 'requirements-monthly.txt'), join(stage, 'requirements-monthly.txt'));
await mkdir(join(stage, 'scripts'), { recursive: true });
await copyFile(join(root, 'scripts/setup-monthly.py'), join(stage, 'scripts/setup-monthly.py'));
const launcher = platform === 'windows' ? '启动选股指南.bat' : '启动选股指南.command';
const launcherContent = await readFile(join(root, launcher), 'utf8');
await writeFile(join(stage, launcher), platform === 'windows' ? launcherContent.replace(/\r?\n/g, '\r\n') : launcherContent.replaceAll('\r\n', '\n'));
if (platform === 'macos') await chmod(join(stage, launcher), 0o755);
if (platform === 'macos') {
  const monthlySetup = '设置月度环境.command';
  await copyFile(join(root, monthlySetup), join(stage, monthlySetup));
  await chmod(join(stage, monthlySetup), 0o755);
}
await copyFile(join(root, 'LICENSE'), join(stage, 'LICENSE'));
await copyFile(join(root, 'docs/PORTABLE.zh-CN.md'), join(stage, '使用说明.md'));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await writeFile(join(stage, 'version.json'), JSON.stringify({ version, platform, node: nodeVersion }, null, 2));

const zip = join(output, `${basename(stage)}.zip`);
await rm(zip, { force: true });
if (platform === 'windows') {
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -LiteralPath ${psQuote(stage)} -DestinationPath ${psQuote(zip)} -CompressionLevel Optimal`]);
} else {
  run('ditto', ['-c', '-k', '--keepParent', stage, zip]);
}
await writeFile(`${zip}.sha256`, `${await checksum(zip)}  ${basename(zip)}\n`);
console.log(`Packaged ${zip}`);
