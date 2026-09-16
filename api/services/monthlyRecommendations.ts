import { execFile, spawn } from 'node:child_process';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { dataFile } from './dataDirectory.js';

const CHECK_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const progressPath = dataFile(`monthly-progress-${process.pid}.json`);
let cachedAt = 0;
let cachedResult: MonthlyResult | null = null;
let running: Promise<void> | null = null;

export interface MonthlyResult {
  success: boolean;
  data: Record<string, unknown>[];
  report: Record<string, unknown>;
  error?: string;
}

export function recommendationMonth(): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  return `${parts.find(part => part.type === 'year')!.value}${parts.find(part => part.type === 'month')!.value}`;
}

function state(status: string, message: string): MonthlyResult {
  return { success: false, data: [], report: {
    status, message, recommendation_month: recommendationMonth(), is_current: false,
    model: '10q 21BB p2 Trial 157', scheme: 'scheme_b', pipeline: ['M0', 'M1', 'M2', 'M3', 'M4'],
    config: { trial: 157, train_months: 58, validation_months: 12, llm: false }, core_factors: [], high: [], low: [],
  } };
}

async function runnerPath(): Promise<string> {
  const candidates = [process.env.TENQ_RUNNER, resolve(process.cwd(), 'monthly_recommendation_runner.py'),
    resolve(process.cwd(), 'scripts', 'monthly_recommendation_runner.py')].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true, () => false)) return candidate;
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
    } catch { /* A dependency may print a non-JSON line. */ }
  }
  throw new Error('月度算法未返回完整结果，将自动重试');
}

function execute(command: string, args: string[]): Promise<string> {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', TENQ_PROGRESS_FILE: progressPath,
        TENQ_CACHE_DIR: process.env.TENQ_CACHE_DIR || dataFile('monthly-cache') } });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout = (stdout + chunk).slice(-4 * 1024 * 1024); });
    // M0 logs can be large. Drain them without buffering credentials or unbounded output.
    child.stderr.resume();
    const stop = () => { child.kill(); };
    process.once('exit', stop);
    const timer = setTimeout(() => { stop(); reject(new Error('月度补数超过 3 小时，已完成数据保留，稍后自动续跑')); }, 3 * 60 * 60 * 1000);
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      process.off('exit', stop);
      if (code === 0) accept(stdout);
      else reject(new Error('月度 Python 进程未正常完成，请检查月度运行环境；系统会自动重试'));
    });
  });
}

async function runBridge(force: boolean): Promise<MonthlyResult> {
  await mkdir(dirname(progressPath), { recursive: true });
  await rm(progressPath, { force: true });
  const script = await runnerPath();
  const configured = process.env.TENQ_PYTHON?.trim();
  const managed = resolve(process.cwd(), '.monthly-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const managedExists = await access(managed).then(() => true, () => false);
  const candidates = configured ? [{ command: configured, args: [script] }]
    : managedExists ? [{ command: managed, args: [script] }]
      : process.platform === 'win32' ? [{ command: 'py', args: ['-3', script] }, { command: 'python', args: [script] }]
        : [{ command: 'python3', args: [script] }, { command: 'python', args: [script] }];
  for (const candidate of candidates) {
    try {
      if (candidate.command === 'py') {
        const resolved = await promisify(execFile)('py', ['-3', '-c', 'import sys; print(sys.executable)'], {
          windowsHide: true, timeout: 10000, encoding: 'utf8',
        });
        candidate.command = resolved.stdout.trim();
        candidate.args = [script];
      }
      return parseOutput(await execute(candidate.command, [...candidate.args, ...(force ? ['--refresh'] : [])]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('找不到 Python 运行环境');
}

export async function getMonthlyRecommendations(force = false): Promise<MonthlyResult> {
  const month = recommendationMonth();
  if (cachedResult?.report.recommendation_month !== month) cachedResult = null;
  const current = cachedResult?.success && cachedResult.report.status === 'ready';
  if (!running && (force || !cachedResult || Date.now() - cachedAt >= (current ? CHECK_MS : RETRY_MS))) {
    cachedResult = null;
    running = runBridge(force).then((result) => {
      const report = result.report;
      if (result.success && (report.status !== 'ready' || report.recommendation_month !== recommendationMonth()
        || report.is_current !== true || result.data.length !== 10)) {
        cachedResult = state('error', '算法返回的持仓不属于当前月份，已拒绝展示，将自动补数重算');
      } else {
        cachedResult = result.success ? result : { ...result, data: [], report: { ...report,
          recommendation_month: recommendationMonth(), high: [], low: [] } };
      }
    }).catch((error: Error) => {
      cachedResult = state('error', error.message);
    }).finally(() => { cachedAt = Date.now(); running = null; });
  }
  if (running) {
    const result = state('updating', '正在检查本月数据并自动补齐历史窗口');
    try {
      const progress = JSON.parse(await readFile(progressPath, 'utf8')) as Record<string, unknown>;
      if (progress.recommendation_month === month) {
        result.report.progress = progress;
        result.report.message = progress.message;
      }
    } catch { /* The Python process has not yet written its first update. */ }
    return result;
  }
  return cachedResult ?? state('updating', '准备本月计算');
}

export function warmupMonthlyRecommendations(): void {
  if (process.env.CUTE_FISH_MONTHLY_AUTO === '0' || !process.env.TUSHARE_TOKEN
    || process.env.TUSHARE_TOKEN === 'your_token_here') return;
  void getMonthlyRecommendations();
}

export function startMonthlyScheduler(): void {
  if (process.env.CUTE_FISH_MONTHLY_AUTO === '0') return;
  warmupMonthlyRecommendations();
  setInterval(warmupMonthlyRecommendations, 60 * 1000).unref();
}
