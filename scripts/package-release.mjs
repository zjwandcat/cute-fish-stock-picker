import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildMacApp, macAppName } from './build-macos-app.mjs';

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
const payload = platform === 'macos' ? join(stage, macAppName, 'Contents', 'Resources', 'app') : stage;
await mkdir(payload, { recursive: true });
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
  const runtime = join(payload, 'runtime', target);
  const nodeName = platform === 'windows' ? 'node.exe' : 'bin/node';
  await mkdir(platform === 'windows' ? runtime : join(runtime, 'bin'), { recursive: true });
  await copyFile(join(cache, name, nodeName), join(runtime, nodeName));
  await copyFile(join(cache, name, 'LICENSE'), join(runtime, 'LICENSE'));
  if (platform === 'macos') await chmod(join(runtime, nodeName), 0o755);
}

// Allowlist package contents: never copy .env, api/data or development node_modules.
await cp(join(root, 'dist'), join(payload, 'dist'), { recursive: true });
await mkdir(join(payload, 'build'));
for (const file of ['server.mjs', 'server.mjs.LEGAL.txt', 'verify-ai-runtime.mjs']) {
  await copyFile(join(root, 'build', file), join(payload, 'build', file));
}
for (const file of ['monthly_recommendation_runner.py', 'monthly_runtime.py', 'monthly_data.py', 'requirements-monthly.txt']) {
  await copyFile(join(root, file), join(payload, file));
}
await mkdir(join(payload, 'scripts'), { recursive: true });
await copyFile(join(root, 'scripts/setup-monthly.py'), join(payload, 'scripts/setup-monthly.py'));

// Install the locked production runtime at build time. Users never run npm.
// The restricted profile disables terminal tools but still needs its native loader.
const aiRuntime = join(payload, 'ai-runtime');
await mkdir(aiRuntime, { recursive: true });
for (const file of ['package.json', 'package-lock.json']) await copyFile(join(root, file), join(aiRuntime, file));
await copyFile(join(root, 'ai-runtime/fish-finance.cordis.yml'), join(aiRuntime, 'fish-finance.cordis.yml'));
if (!process.env.npm_execpath) throw new Error('Run packaging through npm run package -- windows|macos');
run(process.execPath, [process.env.npm_execpath, 'ci', '--prefix', aiRuntime, '--omit=dev',
  '--ignore-scripts', '--no-audit', '--no-fund']);
if (platform === 'macos') {
  // npm installs only the build host's optional binaries. A universal app also
  // needs the other chip's locked binaries, including the Harness loader.
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const otherArch = process.arch === 'arm64' ? 'x64' : 'arm64';
  for (const [path, dependency] of Object.entries(lock.packages)) {
    if (dependency.dev || !dependency.optional || !dependency.os?.includes('darwin') || !dependency.cpu?.includes(otherArch)) continue;
    if (!dependency.resolved?.startsWith('https://registry.npmjs.org/') || !dependency.integrity?.startsWith('sha512-')) {
      throw new Error(`Missing locked native dependency integrity: ${path}`);
    }
    const target = resolve(aiRuntime, path);
    if (!target.startsWith(`${aiRuntime}${sep}`)) throw new Error('Invalid native dependency path');
    const bytes = Buffer.from(await (await getResponse(dependency.resolved)).arrayBuffer());
    const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    if (actual !== dependency.integrity) throw new Error(`Native dependency checksum mismatch: ${path}`);
    const archive = join(cache, `${basename(path)}-${dependency.version}.tgz`);
    await writeFile(archive, bytes);
    await mkdir(target, { recursive: true });
    run('tar', ['-xzf', archive, '-C', target, '--strip-components=1']);
  }
}
const launcher = platform === 'windows' ? '启动选股指南.bat' : '启动选股指南.command';
const launcherContent = await readFile(join(root, launcher), 'utf8');
await writeFile(join(stage, launcher), platform === 'windows' ? launcherContent.replace(/\r?\n/g, '\r\n') : launcherContent.replaceAll('\r\n', '\n'));
if (platform === 'macos') await chmod(join(stage, launcher), 0o755);
if (platform === 'macos') {
  const monthlySetup = '设置月度环境.command';
  await copyFile(join(root, monthlySetup), join(stage, monthlySetup));
  await chmod(join(stage, monthlySetup), 0o755);
  await cp(join(payload, 'scripts'), join(stage, 'scripts'), { recursive: true });
  await copyFile(join(root, 'requirements-monthly.txt'), join(stage, 'requirements-monthly.txt'));
}
await copyFile(join(root, 'LICENSE'), join(stage, 'LICENSE'));
await copyFile(join(root, 'docs/PORTABLE.zh-CN.md'), join(stage, '使用说明.md'));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const metadata = { version, platform, node: nodeVersion, macApp: platform === 'macos',
  architectures: platform === 'macos' ? ['arm64', 'x64'] : ['x64'],
  aiRuntime: 'bundled', appleNotarized: false };
await writeFile(join(payload, 'version.json'), JSON.stringify(metadata, null, 2));
if (platform === 'macos') {
  await copyFile(join(payload, 'version.json'), join(stage, 'version.json'));
  await buildMacApp(stage, version);
}

const nativeNode = join(payload, 'runtime', platform === 'windows' ? 'win-x64/node.exe' : `darwin-${process.arch}/bin/node`);
run(nativeNode, [join(payload, 'build/verify-ai-runtime.mjs')]);

const zip = join(output, `${basename(stage)}.zip`);
const pendingZip = join(output, `${basename(stage)}.pending.zip`);
await rm(pendingZip, { force: true });
if (platform === 'windows') {
  run('tar.exe', ['-a', '-cf', pendingZip, '-C', output, basename(stage)]);
} else {
  run('ditto', ['-c', '-k', '--keepParent', stage, pendingZip]);
}
await rename(pendingZip, zip);
await writeFile(`${zip}.sha256`, `${await checksum(zip)}  ${basename(zip)}\n`);
console.log(`Packaged ${zip}`);
