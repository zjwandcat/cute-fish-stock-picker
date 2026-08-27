/**
 * 腾讯控股 (00700.HK) 实时价格监控脚本
 *
 * 监控规则:
 *  - 价格跌破 445 → 进入建仓区提醒（高优先级）
 *  - 价格跌破 432 → 止损警告（紧急）
 *
 * 运行方式:
 *   node --import tsx api/scripts/monitorTencent.ts
 *
 * 检查频率: 每 30 秒
 * 通知方式: macOS 系统通知 (osascript) + 日志文件
 * 重复抑制: 同一信号 10 分钟内只通知一次
 */
import { appendFileSync } from 'node:fs';
import { getSinaRealtimeQuote } from '../services/realtime.js';

// ============== 监控配置 ==============
const TENCENT_CODE = '00700.HK';
const TENCENT_NAME = '腾讯控股';

// 价位配置（可按需调整）
const PRICE_LEVELS = [
  { level: 445, type: 'entry' as const, label: '进入建仓区', priority: 'high' as const },
  { level: 432, type: 'stop' as const, label: '触及止损位', priority: 'urgent' as const },
];

const CHECK_INTERVAL_MS = 30 * 1000; // 每 30 秒检查
const SUPPRESS_WINDOW_MS = 10 * 60 * 1000; // 同一信号 10 分钟内不重复
const LOG_FILE = '/tmp/tencent_monitor.log';

// 港股交易时间: 9:30-12:00, 13:00-16:00
function isHKTradingHours(now = new Date()): boolean {
  // 周末不监控
  const day = now.getDay();
  if (day === 0 || day === 6) return false;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const morning = minutes >= 9 * 60 + 30 && minutes <= 12 * 60;
  const afternoon = minutes >= 13 * 60 && minutes <= 16 * 60;
  return morning || afternoon;
}

// ============== 通知机制 ==============
const lastAlertedAt: Record<string, number> = {};

function log(line: string): void {
  const ts = new Date().toLocaleString('zh-CN', { hour12: false });
  const msg = `[${ts}] ${line}`;
  console.log(msg);
  // 同时追加到日志文件
  try {
    appendFileSync(LOG_FILE, msg + '\n');
  } catch {
    // 忽略日志文件写入失败
  }
}

/**
 * 发送 macOS 系统通知。
 * 失败时静默降级（仍会写入日志）。
 */
async function sendNotification(title: string, message: string, priority: 'high' | 'urgent'): Promise<void> {
  // 紧急通知带声音
  const sound = priority === 'urgent' ? 'Basso' : 'Glass';
  const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}" sound name "${sound}"`;

  try {
    const { exec } = await import('node:child_process');
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
      if (err) {
        log(`⚠️ 系统通知发送失败: ${err.message}`);
      }
    });
  } catch {
    // 非macOS或osascript不可用，忽略
  }
}

/**
 * 判断信号是否应被抑制（10分钟内已通知过）。
 */
function shouldSuppress(key: string): boolean {
  const last = lastAlertedAt[key] ?? 0;
  return Date.now() - last < SUPPRESS_WINDOW_MS;
}

function markAlerted(key: string): void {
  lastAlertedAt[key] = Date.now();
}

// ============== 监控主循环 ==============
async function checkOnce(): Promise<void> {
  if (!isHKTradingHours()) {
    // 非交易时段，静默跳过
    return;
  }

  let quote;
  try {
    quote = await getSinaRealtimeQuote(TENCENT_CODE);
  } catch (err) {
    log(`❌ 获取 ${TENCENT_NAME} 行情失败: ${(err as Error).message}`);
    return;
  }

  if (!quote || !quote.price || quote.price <= 0) {
    log(`⚠️ ${TENCENT_NAME} 行情数据为空，跳过本次检查`);
    return;
  }

  const { price, pct_chg, high, low } = quote;
  const sign = pct_chg >= 0 ? '+' : '';
  log(`📊 ${TENCENT_NAME} 现价 HK$${price.toFixed(2)} (${sign}${pct_chg.toFixed(2)}%) 高:${high.toFixed(2)} 低:${low.toFixed(2)}`);

  // 检查所有价位
  for (const cfg of PRICE_LEVELS) {
    if (price <= cfg.level) {
      const key = `${TENCENT_CODE}_${cfg.type}_${cfg.level}`;
      if (shouldSuppress(key)) {
        // 已通知过，不重复
        continue;
      }

      const distance = ((price - cfg.level) / cfg.level * 100).toFixed(2);
      const direction = price < cfg.level ? '已跌破' : '触及';

      const title = cfg.priority === 'urgent'
        ? `🛑 紧急: ${TENCENT_NAME} ${cfg.label}`
        : `🎯 ${TENCENT_NAME} ${cfg.label}`;

      const message = cfg.type === 'stop'
        ? `现价 HK$${price.toFixed(2)} ${direction}止损位 ${cfg.level}（${distance}%），建议立即止损出局`
        : `现价 HK$${price.toFixed(2)} ${direction}建仓区下沿 ${cfg.level}（${distance}%），可按计划分批建仓`;

      log(`🚨 ${title} - ${message}`);
      await sendNotification(title, message, cfg.priority);
      markAlerted(key);
    }
  }
}

async function main(): Promise<void> {
  log(`===== ${TENCENT_NAME} 监控启动 =====`);
  log(`监控价位: ${PRICE_LEVELS.map(p => `${p.label}=${p.level}`).join(', ')}`);
  log(`检查频率: 每 ${CHECK_INTERVAL_MS / 1000} 秒`);
  log(`交易时段: 9:30-12:00, 13:00-16:00 (周一至周五)`);
  log(`日志文件: ${LOG_FILE}`);
  log(`================================`);

  // 首次立即检查
  await checkOnce();

  // 定时检查
  setInterval(async () => {
    try {
      await checkOnce();
    } catch (err) {
      log(`❌ 检查异常: ${(err as Error).message}`);
    }
  }, CHECK_INTERVAL_MS);

  // 优雅退出
  process.on('SIGINT', () => {
    log(`===== ${TENCENT_NAME} 监控停止 =====`);
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    log(`===== ${TENCENT_NAME} 监控停止 =====`);
    process.exit(0);
  });
}

main().catch((err) => {
  log(`❌ 监控启动失败: ${err.message}`);
  process.exit(1);
});
