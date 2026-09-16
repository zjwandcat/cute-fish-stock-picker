/** Production entry for the self-contained macOS and Windows downloads. */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env'), quiet: true });

const userDataRoot = process.platform === 'win32'
  ? process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  : process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support')
    : join(homedir(), '.local', 'share');
const dataDirectory = resolve(process.env.CUTE_FISH_DATA_DIR || join(userDataRoot, 'Cute Fish Stock Picker'));
process.env.CUTE_FISH_DATA_DIR = dataDirectory;
await mkdir(dataDirectory, { recursive: true });
const configPath = join(dataDirectory, 'config.json');
try {
  const config = JSON.parse(await readFile(configPath, 'utf8')) as { tushareToken?: string };
  if (config.tushareToken) process.env.TUSHARE_TOKEN = config.tushareToken;
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.warn('Could not read saved configuration. Open /setup to enter your token again.');
  }
}

// Import after setting the data directory; service paths are initialized at import time.
const { default: api } = await import('./app.js');
const { warmupBagholder50 } = await import('./services/bagholder.js');
const { startMonthlyScheduler, warmupMonthlyRecommendations } = await import('./services/monthlyRecommendations.js');
const configured = (): boolean => Boolean(process.env.TUSHARE_TOKEN && process.env.TUSHARE_TOKEN !== 'your_token_here');
const local = express();
let origin = '';

// Only the local app can access its API, including token and portfolio writes.
local.use((req, res, next) => {
  if (req.headers.host !== new URL(origin).host
    || (req.headers.origin && req.headers.origin !== origin)
    || req.headers['sec-fetch-site'] === 'cross-site') {
    res.status(403).json({ success: false, error: 'Local access only' });
    return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
local.use(express.json({ limit: '16kb' }));
local.get('/api/local/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, configured: configured() });
});
local.put('/api/local/config', async (req, res) => {
  const token: unknown = req.body?.token;
  if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{20,200}$/.test(token.trim())) {
    res.status(400).json({ success: false, error: '请粘贴完整的 Tushare Token。' });
    return;
  }
  try {
    const temporary = `${configPath}.tmp`;
    await writeFile(temporary, JSON.stringify({ tushareToken: token.trim() }), { mode: 0o600 });
    await rename(temporary, configPath);
    process.env.TUSHARE_TOKEN = token.trim();
    res.json({ success: true });
    warmupBagholder50();
    warmupMonthlyRecommendations();
  } catch {
    res.status(500).json({ success: false, error: '保存失败，请检查用户目录是否可写。' });
  }
});
local.get('/api/health', (_req, res) => {
  res.json({ success: true, application: 'cute-fish-stock-picker', configured: configured() });
});
local.get('/setup', (_req, res) => {
  res.sendFile(join(root, 'dist', 'setup.html'));
});
local.use('/api', (_req, res, next) => {
  if (!configured()) {
    res.status(503).json({ success: false, error: '请先在 /setup 配置 Tushare Token。' });
    return;
  }
  next();
});
local.use((req, res, next) => {
  if (req.path === '/' && !configured()) {
    res.redirect('/setup');
    return;
  }
  next();
});
local.use(express.static(join(root, 'dist')));
local.use(api);

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be between 0 and 65535');

function openBrowser(url: string): void {
  if (process.env.CUTE_FISH_NO_BROWSER === '1') return;
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.warn(`Open ${url} in your browser.`));
  child.unref();
}

const server = local.listen(port, '127.0.0.1');
server.once('listening', () => {
  const address = server.address();
  if (!address || typeof address === 'string') return;
  origin = `http://127.0.0.1:${address.port}`;
  console.log(`Cute Fish Stock Picker: ${origin}`);
  console.log('Keep this window open. Press Ctrl+C to stop.');
  openBrowser(origin);
  if (configured()) warmupBagholder50();
  startMonthlyScheduler();
});
server.on('error', async (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    // Reuse our own running app; an unrelated process is never terminated.
    const url = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
      const health = await response.json() as { application?: string };
      if (health.application === 'cute-fish-stock-picker') {
        openBrowser(url);
        process.exit(0);
      }
    } catch { /* An unrelated service may not provide a health endpoint. */ }
    // Pick a free port when another application owns the preferred port.
    server.listen(0, '127.0.0.1');
    return;
  }
  console.error('Could not start the local app:', err.code || err.message);
  process.exit(1);
});
function shutdown(): void {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
