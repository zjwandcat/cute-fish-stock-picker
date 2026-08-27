import { Router, type Request, type Response } from 'express';

import {
  analyzeAll,
  getAlerts,
  clearAlerts,
  type StockSnapshot,
  type UserTargets,
} from '../services/alertEngine.js';
import { STOCK_POOL } from '../services/stockPool.js';
import { isHK } from '../services/realtime.js';
import { getHKBasics, getHKDailyBars } from '../services/hkQuotes.js';
import {
  getDailyBasicBatch,
  getDailyBars,
  getToday,
  getDateNDaysAgo,
} from '../services/tushare.js';

const router = Router();

// 内存中保存用户的目标价配置(生产环境应放数据库)
const userTargets: UserTargets = {};

/**
 * GET /api/alerts - 获取当前告警列表
 */
router.get('/alerts', async (req: Request, res: Response): Promise<void> => {
  try {
    const refresh = req.query.refresh === '1';
    if (refresh) {
      await runAnalysis();
    }
    res.json({ success: true, data: getAlerts(50) });
  } catch (err) {
    console.error('获取告警失败:', err);
    res.json({ success: true, data: [] });
  }
});

/**
 * POST /api/alerts/analyze - 手动触发一次分析
 */
router.post('/alerts/analyze', async (_req: Request, res: Response): Promise<void> => {
  try {
    const alerts = await runAnalysis();
    res.json({ success: true, data: alerts });
  } catch (err) {
    console.error('分析告警失败:', err);
    res.json({ success: true, data: [] });
  }
});

/**
 * POST /api/alerts/targets - 设置用户目标价
 * body: { ts_code, buy, stop_loss, alert_pct }
 */
router.post('/alerts/targets', (req: Request, res: Response): void => {
  const { ts_code, buy, stop_loss, alert_pct } = req.body ?? {};
  if (!ts_code) {
    res.status(400).json({ success: false, error: 'ts_code 必填' });
    return;
  }
  userTargets[ts_code] = { buy, stop_loss, alert_pct };
  res.json({ success: true, data: userTargets });
});

/**
 * GET /api/alerts/targets - 获取所有目标价
 */
router.get('/alerts/targets', (_req: Request, res: Response): void => {
  res.json({ success: true, data: userTargets });
});

/**
 * DELETE /api/alerts - 清空告警历史
 */
router.delete('/alerts', (_req: Request, res: Response): void => {
  clearAlerts();
  res.json({ success: true });
});

/**
 * 拉取最新行情并执行分析
 */
async function runAnalysis(): Promise<ReturnType<typeof analyzeAll>> {
  const today = getToday();
  const codes = STOCK_POOL.map((s) => s.ts_code);
  // 基本面:A股用 Tushare,港股用腾讯行情(PE/PB/市值实时)
  const [basicMap, hkBasicMap] = await Promise.all([
    getDailyBasicBatch(codes.filter((c) => !isHK(c)), today),
    getHKBasics(codes.filter(isHK)),
  ]);
  for (const [code, basic] of hkBasicMap) basicMap.set(code, basic);

  const snapshots: StockSnapshot[] = [];
  for (const stock of STOCK_POOL) {
    // 港股K线来自腾讯(含当日实时K线);A股来自 Tushare
    const bars = isHK(stock.ts_code)
      ? await getHKDailyBars(stock.ts_code, 6)
      : await getDailyBars(stock.ts_code, getDateNDaysAgo(5), today);
    const basic = basicMap.get(stock.ts_code) ?? null;
    const latest = bars.length > 0 ? bars[bars.length - 1] : null;
    const prev = bars.length > 1 ? bars[bars.length - 2] : null;

    const preClose = prev?.close ?? latest?.open ?? 0;
    const price = latest?.close ?? 0;
    const changePct = preClose > 0 ? ((price - preClose) / preClose) * 100 : 0;

    // 估算量比
    let volRatio = 0;
    if (bars.length >= 2) {
      const vols = bars.slice(0, -1).map((b) => b.vol);
      const avgVol = vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;
      volRatio = avgVol > 0 ? (latest?.vol ?? 0) / avgVol : 0;
    }

    snapshots.push({
      ts_code: stock.ts_code,
      name: stock.name,
      price,
      pre_close: preClose,
      change_pct: changePct,
      pe_ttm: basic?.pe_ttm ?? 0,
      pb: basic?.pb ?? 0,
      volume_ratio: +volRatio.toFixed(2),
      turnover_rate: basic?.turnover_rate ?? 0,
      total_mv: basic?.total_mv ?? 0,
      high: latest?.high ?? price,
      low: latest?.low ?? price,
    });
  }

  return analyzeAll(snapshots, userTargets);
}

export default router;
