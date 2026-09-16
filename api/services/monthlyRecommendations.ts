import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { dataFile } from './dataDirectory.js';

const execFileAsync = promisify(execFile);
const CACHE_MS = 15 * 1000;
let cachedAt = 0;
let cachedResult: MonthlyResult | null = null;
let running: Promise<MonthlyResult> | null = null;

export interface MonthlyResult {
  success: boolean;
  data: Record<string, unknown>[];
  report: Record<string, unknown>;
  error?: string;
}

async function runnerPath(): Promise<string> {
  const candidates = [
    process.env.TENQ_RUNNER,
    resolve(process.cwd(), 'monthly_recommendation_runner.py'),
    resolve(process.cwd(), 'scripts', 'monthly_recommendation_runner.py'),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch { /* try the next packaged/source location */ }
  }
  throw new Error('月度算法 bridge 文件不存在');
}

function parseOutput(stdout: string): MonthlyResult {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].trim().startsWith('{')) continue;
    try {
      const parsed = JSON.parse(lines[index]) as MonthlyResult;
      if (parsed && Array.isArray(parsed.data) && parsed.report) return parsed;
    } catch { /* keep scanning in case a Python dependency printed a line */ }
  }
  throw new Error('月度算法返回了无法解析的结果');
}

async function runBridge(force: boolean): Promise<MonthlyResult> {
  const script = await runnerPath();
  const configured = process.env.TENQ_PYTHON?.trim();
  const managed = resolve(process.cwd(), '.monthly-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const managedExists = await access(managed).then(() => true, () => false);
  const candidates: { command: string; args: string[] }[] = configured
    ? [{ command: configured, args: [script] }]
    : managedExists ? [{ command: managed, args: [script] }]
      : process.platform === 'win32'
        ? [
          { command: 'py', args: ['-3', script] },
          { command: 'python', args: [script] },
        ]
        : [{ command: 'python3', args: [script] }, { command: 'python', args: [script] }];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const result = await execFileAsync(candidate.command, [...candidate.args, ...(force ? ['--refresh'] : [])], {
        cwd: process.cwd(),
        env: { ...process.env, TENQ_CACHE_DIR: process.env.TENQ_CACHE_DIR || dataFile('monthly-cache') },
        timeout: 12 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      });
      return parseOutput(result.stdout);
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('找不到 Python 运行环境');
}

export async function getMonthlyRecommendations(force = false): Promise<MonthlyResult> {
  if (!force && cachedResult && Date.now() - cachedAt < CACHE_MS) return cachedResult;
  if (!running) {
    running = runBridge(force)
      .then((result) => {
        cachedResult = result.success ? result : null;
        cachedAt = Date.now();
        return result;
      })
      .finally(() => { running = null; });
  }
  return running;
}
