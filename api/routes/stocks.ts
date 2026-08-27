import { Router, type Request, type Response } from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import axios from 'axios';
import iconv from 'iconv-lite';

import { STOCK_POOL, addStock, removeStock, normalizeCode } from '../services/stockPool.js';
import { isHK } from '../services/realtime.js';
import {
  getDailyBars,
  getDailyBasic,
  getDailyBasicBatch,
  getTop10Holders,
  getAnnouncements,
  getDividends,
  getMoneyFlow,
  getToday,
  getDateNDaysAgo,
  type DailyBar,
} from '../services/tushare.js';
import {
  scoreStocks,
  applySectorDiversification,
  type StockData,
  type Recommendation,
} from '../services/scoring.js';
import { getOverridePrice } from '../services/priceOverride.js';
import { getSinaRealtimeQuotes, type RealtimeQuote } from '../services/realtime.js';
import { getHKQuotes, getHKBasics, getHKDailyBars, toRealtimeQuote } from '../services/hkQuotes.js';
import { getAHComparison, type AHComparison } from '../services/ahCompare.js';
import * as cache from '../services/cache.js';
import {
  computeTET,
  computeMACDV,
  computeSellSignals,
  computeBuySignals,
  DEFAULT_MACDV,
  type MACDVConfig,
  type TETResult,
  type MACDVResult,
  type BagholderSignalInput,
} from '../services/indicators.js';
import {
  getBagholder50,
  getBagholderStatus,
  type BagholderStockStatus,
} from '../services/bagholder.js';

const router = Router();

/**
 * GET /api/stocks - 获取全部自选股实时行情
 */
router.get('/stocks', async (_req: Request, res: Response): Promise<void> => {
  try {
    const today = getToday();
    const codes = STOCK_POOL.map((s) => s.ts_code);

    // 基本面:A股用 Tushare daily_basic,港股用腾讯行情(PE/PB/市值/换手率,30秒缓存自动更新)
    const [basicMap, hkBasicMap] = await Promise.all([
      getDailyBasicBatch(codes.filter((c) => !isHK(c)), today),
      getHKBasics(codes.filter(isHK)),
    ]);
    for (const [code, basic] of hkBasicMap) basicMap.set(code, basic);

    // 获取新浪实时行情(盘中实时更新)
    const realtimeMap = new Map<string, { price: number; change_pct: number }>();
    try {
      const realtimeQuotes = await getSinaRealtimeQuotes(codes);
      for (const q of realtimeQuotes) {
        realtimeMap.set(q.ts_code, { price: q.price, change_pct: q.pct_chg });
      }
    } catch (err) {
      console.error('新浪实时行情失败,回退到 Tushare:', (err as Error).message);
    }

    const results: Record<string, unknown>[] = [];
    for (const stock of STOCK_POOL) {
      // 港股K线来自腾讯(最后一行为当日实时K线,量比盘中更新);A股来自 Tushare
      const bars = isHK(stock.ts_code)
        ? await getHKDailyBars(stock.ts_code, 6)
        : await getDailyBars(stock.ts_code, getDateNDaysAgo(5), today);
      const basic = basicMap.get(stock.ts_code) ?? null;
      const override = getOverridePrice(stock.ts_code);
      const realtime = realtimeMap.get(stock.ts_code);

      const latest = bars.length > 0 ? bars[bars.length - 1] : null;

      // 优先级:新浪实时 > Tushare > override
      const price = realtime?.price ?? latest?.close ?? override?.price ?? 0;
      const changePct = realtime?.change_pct ?? latest?.pct_chg ?? override?.change_pct ?? 0;

      // 计算量比:当日成交量 / 过去 5 日平均成交量
      let volumeRatio = 0;
      if (bars.length >= 2) {
        const vols = bars.slice(0, -1).map((b) => b.vol);
        const avgVol = vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;
        volumeRatio = avgVol > 0 ? (latest?.vol ?? 0) / avgVol : 0;
      }

      // total_mv 在 daily_basic 是万元,override 是亿元
      const totalMv = basic?.total_mv ?? (override ? override.total_mv * 10000 : 0);

      results.push({
        ts_code: stock.ts_code,
        name: stock.name,
        market: isHK(stock.ts_code) ? 'HK' : 'A', // 市场：HK=港股, A=A股
        currency: isHK(stock.ts_code) ? 'HKD' : 'CNY', // 币种
        price,
        change_pct: changePct,
        pe_ttm: basic?.pe_ttm ?? override?.pe_ttm ?? 0,
        pb: basic?.pb ?? override?.pb ?? 0,
        volume_ratio: +volumeRatio.toFixed(2),
        total_mv: totalMv,
        turnover_rate: basic?.turnover_rate ?? override?.turnover_rate ?? 0,
      });
    }

    res.json({ success: true, data: results });
  } catch (err) {
    console.error('获取自选股行情失败:', err);
    res.json({ success: true, data: [] });
  }
});

/**
 * GET /api/stocks/:code/daily - 获取个股日 K 线
 */
router.get('/stocks/:code/daily', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 120;

    // 港股K线来自腾讯行情;A股来自 Tushare
    const result = isHK(code)
      ? (await getHKDailyBars(code, limit)).slice(-limit)
      : (await getDailyBars(code, getDateNDaysAgo(Math.ceil(limit * 1.5)), getToday())).slice(-limit);

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('获取日 K 线失败:', err);
    res.json({ success: true, data: [] });
  }
});

/**
 * GET /api/stocks/:code/detail - 获取个股详情
 */
router.get('/stocks/:code/detail', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.params;
    const today = getToday();

    const stock = STOCK_POOL.find((s) => s.ts_code === code);

    const [bars, basic, holders, announcements, dividends] = await Promise.all([
      // 港股K线/基本面来自腾讯行情(PE/PB/市值/换手率实时)
      isHK(code) ? getHKDailyBars(code, 10) : getDailyBars(code, getDateNDaysAgo(10), today),
      isHK(code) ? getHKBasics([code]).then((m) => m.get(code) ?? null) : getDailyBasic(code, today),
      getTop10Holders(code),
      getAnnouncements(code),
      getDividends(code),
    ]);

    const override = getOverridePrice(code);

    // 只取最新财报期的十大股东(避免同一股东跨期重复)
    const latestEndDate = holders.length > 0
      ? holders.reduce((max, h) => (h.end_date > max ? h.end_date : max), holders[0].end_date)
      : '';
    const latestHolders = holders.filter((h) => h.end_date === latestEndDate);

    // 计算机构持股占比(优化关键词,排除个人名称误判)
    const instKeywords = [
      '基金', '社保', '保险', '信托', '证券', '银行', 'QFII',
      '香港中央结算', '资产管理', '资产管理计划', '基本养老保险',
      '企业年金', '全国社保', '基本养老保险基金',
    ];
    // 排除关键词:如果股东名称包含这些,即使是机构类型也视为个人
    const excludeKeywords = ['自然人', '个人', '先生', '女士'];

    let instRatio = 0;
    for (const h of latestHolders) {
      const name = h.holder_name;
      // 先排除明确的个人标识
      if (excludeKeywords.some((kw) => name.includes(kw))) continue;
      // 精确匹配机构关键词
      if (instKeywords.some((kw) => name.includes(kw))) {
        instRatio += h.hold_ratio;
      }
    }
    // 机构占比不超过十大股东合计持股比例
    const top10TotalRatio = latestHolders.reduce((sum, h) => sum + h.hold_ratio, 0);
    instRatio = Math.min(instRatio, top10TotalRatio);
    const retailRatio = Math.max(0, +(top10TotalRatio - instRatio).toFixed(2));

    // 获取上一交易日资金流向数据
    const prevTradeDate = bars.length >= 2 ? bars[bars.length - 2].trade_date : '';
    let moneyFlow = null;
    if (prevTradeDate) {
      moneyFlow = await getMoneyFlow(code, prevTradeDate);
    }

    // 计算四个资金流向比例
    let instInflow = 0;
    let instOutflow = 0;
    let retailInflow = 0;
    let retailOutflow = 0;

    if (moneyFlow) {
      // 机构 = 大单 + 超大单
      const instBuy = moneyFlow.buy_lg_amount + moneyFlow.buy_elg_amount;
      const instSell = moneyFlow.sell_lg_amount + moneyFlow.sell_elg_amount;
      // 散户 = 小单 + 中单
      const retailBuy = moneyFlow.buy_sm_amount + moneyFlow.buy_md_amount;
      const retailSell = moneyFlow.sell_sm_amount + moneyFlow.sell_md_amount;

      const totalFlow = instBuy + instSell + retailBuy + retailSell;
      if (totalFlow > 0) {
        instInflow = +((instBuy / totalFlow) * 100).toFixed(2);
        instOutflow = +((instSell / totalFlow) * 100).toFixed(2);
        retailInflow = +((retailBuy / totalFlow) * 100).toFixed(2);
        retailOutflow = +((retailSell / totalFlow) * 100).toFixed(2);
      }
    }

    // 估算主力净流入(万元)
    let mainNetInflow = 0;
    if (moneyFlow) {
      const instNet = (moneyFlow.buy_lg_amount + moneyFlow.buy_elg_amount)
        - (moneyFlow.sell_lg_amount + moneyFlow.sell_elg_amount);
      mainNetInflow = instNet;
    } else if (bars.length >= 2) {
      const latest = bars[bars.length - 1];
      const prev = bars[bars.length - 2];
      if (latest.close > prev.close && latest.vol > prev.vol) {
        mainNetInflow = latest.amount - prev.amount;
      } else {
        mainNetInflow = -(latest.amount - prev.amount);
      }
    }

    // 量比
    let volumeRatio = 0;
    if (bars.length >= 2) {
      const vols = bars.slice(0, -1).map((b) => b.vol);
      const avgVol = vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;
      const latestVol = bars.length > 0 ? bars[bars.length - 1].vol : 0;
      volumeRatio = avgVol > 0 ? +(latestVol / avgVol).toFixed(2) : 0;
    }

    // 估算 ROE ≈ PB/PE * 100
    const peTtm = basic?.pe_ttm ?? 0;
    const roe = peTtm > 0
      ? +(((basic?.pb ?? 0) / peTtm) * 100).toFixed(2)
      : 0;

    // 从公告中分类:会议 / 大事件决策
    const meetingKeywords = ['股东大会', '董事会', '监事会', '会议'];
    const eventKeywords = ['重大', '重组', '收购', '并购', '增发', '配股', '减持', '增持', '回购', '股权激励', '定向增发', '资产'];

    const meetings = announcements
      .filter((a) => meetingKeywords.some((kw) => a.title.includes(kw) || a.ann_type.includes(kw)))
      .slice(0, 5);

    const events = announcements
      .filter((a) => eventKeywords.some((kw) => a.title.includes(kw)))
      .slice(0, 5);

    // 过滤有除权除息日的分红记录
    const exDividends = dividends
      .filter((d) => d.ex_date)
      .sort((a, b) => b.ex_date.localeCompare(a.ex_date))
      .slice(0, 5);

    // 十大股东数量审核
    const holderCount = latestHolders.length;
    const holderIncomplete = holderCount < 10;

    const detail = {
      ts_code: code,
      name: stock?.name || '',
      price: override?.price ?? (bars.length > 0 ? bars[bars.length - 1].close : 0),
      change_pct: override?.change_pct ?? (bars.length > 0 ? bars[bars.length - 1].pct_chg : 0),
      pe_ttm: override?.pe_ttm ?? basic?.pe_ttm ?? 0,
      pe_static: basic?.pe ?? 0,
      pb: override?.pb ?? basic?.pb ?? 0,
      roe,
      total_mv: override ? override.total_mv * 10000 : (basic?.total_mv ?? 0),
      circ_mv: basic?.circ_mv ?? 0,
      inst_ratio: +instRatio.toFixed(2),
      retail_ratio: retailRatio,
      main_net_inflow: +mainNetInflow.toFixed(2),
      inst_inflow_ratio: instInflow,
      inst_outflow_ratio: instOutflow,
      retail_inflow_ratio: retailInflow,
      retail_outflow_ratio: retailOutflow,
      volume_ratio: volumeRatio,
      turnover_rate: override?.turnover_rate ?? basic?.turnover_rate ?? 0,
      volume: bars.length > 0 ? bars[bars.length - 1].vol : 0,
      meetings,
      events,
      dividends: exDividends,
      holders: latestHolders
        .sort((a, b) => b.hold_ratio - a.hold_ratio)
        .slice(0, 10),
      holder_count: holderCount,
      holder_incomplete: holderIncomplete,
    };

    res.json({ success: true, data: detail });
  } catch (err) {
    console.error('获取个股详情失败:', err);
    res.json({ success: true, data: null });
  }
});

/**
 * GET /api/stocks/:code/news - 获取个股新闻
 */
router.get('/stocks/:code/news', async (_req: Request, res: Response): Promise<void> => {
  // 暂无新闻接口权限,直接返回空数组
  res.json({ success: true, data: [] });
});

/**
 * 全股池多因子综合评分（"资金面"模式，当前评分方案）
 * 盘中实时行情注入 + 280日K线 + 十大股东 + 资金流，scoreStocks 加权合成
 * 30秒缓存与实时行情刷新节奏一致
 */
async function getCapitalScored(): Promise<Recommendation[]> {
  const cached = cache.get<Recommendation[]>('capital_scored_all');
  if (cached) return cached;

  const today = getToday();
  const codes = STOCK_POOL.map((s) => s.ts_code);

  // 并行：基本面 + 实时行情（盘中实时数据）
  // A股: Tushare 基本面 + 新浪实时;港股: 腾讯行情(PE/PB/市值+实时价,单位与港股K线一致)
  const [basicMap, hkBasicMap, realtimeQuotes, hkQuoteMap] = await Promise.all([
    getDailyBasicBatch(codes.filter((c) => !isHK(c)), today),
    getHKBasics(codes.filter(isHK)),
    getSinaRealtimeQuotes(codes).catch((err) => {
      console.error('实时行情失败，使用T-1数据:', (err as Error).message);
      return [] as Awaited<ReturnType<typeof getSinaRealtimeQuotes>>;
    }),
    getHKQuotes(codes.filter(isHK)),
  ]);
  for (const [code, basic] of hkBasicMap) basicMap.set(code, basic);
  const realtimeMap = new Map(realtimeQuotes.map((q) => [q.ts_code, q]));
  for (const [code, hkq] of hkQuoteMap) realtimeMap.set(code, toRealtimeQuote(hkq));

  const stockDataList: StockData[] = [];
  for (const stock of STOCK_POOL) {
    const [bars, holders] = await Promise.all([
      // 港股K线来自腾讯(280日支持12M动量);A股拉长到 280 日
      isHK(stock.ts_code)
        ? getHKDailyBars(stock.ts_code, 280)
        : getDailyBars(stock.ts_code, getDateNDaysAgo(280), today),
      getTop10Holders(stock.ts_code),
    ]);

    // 获取最近交易日资金流（大单/超大单净流入）
    let moneyFlow = null;
    const lastBar = bars[bars.length - 1];
    if (lastBar) {
      moneyFlow = await getMoneyFlow(stock.ts_code, lastBar.trade_date);
    }

    stockDataList.push({
      ts_code: stock.ts_code,
      name: stock.name,
      bars,
      basic: basicMap.get(stock.ts_code) ?? null,
      holders,
      moneyFlow,
      realtime: realtimeMap.get(stock.ts_code) ?? null,
    });
  }

  const scored = scoreStocks(stockDataList);
  cache.set('capital_scored_all', scored, 30 * 1000);
  return scored;
}

/**
 * GET /api/recommendations - 获取今日推荐（默认 5 只）
 * ?mode=capital 资金面综合评分（当前评分方案，含 T+1 调整与强制 Top4）
 * ?mode=tet     按 TET 买入信号评分排序（NAAIM 2025 趋势-情绪-时机）
 * ?mode=macdv   按 MACD-V 买入信号评分排序（SSRN #4099617 波动率归一化动量）
 * ?mode=double  TET 与 MACD-V 买入信号同时点亮，再按资金面综合评分排序（前5）
 * 盘中每30秒调用都会更新结果（依赖新浪实时行情）
 */
router.get('/recommendations', async (req: Request, res: Response): Promise<void> => {
  try {
    const mode = String(req.query.mode ?? 'capital');
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 5, 1), 20);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const scored = await getCapitalScored();
    const scoreMap = new Map(scored.map((s) => [s.ts_code, s]));
    const industryMap = new Map(STOCK_POOL.map((s) => [s.ts_code, s.industry]));

    let finalRanked: Recommendation[];

    if (mode === 'double') {
      // 双共振模式：TET 与 MACD-V 同时点亮买入信号（buy_signal=good），再按资金面综合评分排序
      const signals = await getPoolSignals();
      const entries: Recommendation[] = [];
      for (const sig of signals) {
        if (!sig.tet || !sig.macdv) continue;
        // 两个指标必须同时给出买入信号（good）
        if (sig.tet.buy_signal !== 'good' || sig.macdv.buy_signal !== 'good') continue;
        const base = scoreMap.get(sig.ts_code);
        const poolItem = STOCK_POOL.find((s) => s.ts_code === sig.ts_code);
        entries.push({
          ts_code: sig.ts_code,
          name: poolItem?.name ?? base?.name ?? sig.ts_code,
          tech_score: base?.tech_score ?? 0,
          fundamental_score: base?.fundamental_score ?? 0,
          capital_score: base?.capital_score ?? 0,
          total_score: base?.total_score ?? 0, // 资金面综合评分（排序依据）
          signals: ['双指标共振', ...tetReasons(sig.tet), ...macdvReasons(sig.macdv)].slice(0, 8),
          next_day_adjust: base?.next_day_adjust ?? 0,
          risk_level: base?.risk_level ?? 'medium',
        });
      }
      entries.sort((a, b) => b.total_score - a.total_score);

      // 行业分散约束：Top 5 每个行业最多 2 只
      const diversified = applySectorDiversification(entries, industryMap, limit, 2);
      const diversifiedCodes = new Set(diversified.map((r) => r.ts_code));
      finalRanked = [...diversified, ...entries.filter((r) => !diversifiedCodes.has(r.ts_code))];
    } else if (mode === 'tet' || mode === 'macdv') {
      // TET / MACD-V 模式：按对应算法买入信号评分排序
      const signals = await getPoolSignals();
      const entries: Recommendation[] = [];
      for (const sig of signals) {
        const base = scoreMap.get(sig.ts_code);
        const poolItem = STOCK_POOL.find((s) => s.ts_code === sig.ts_code);
        if (mode === 'tet') {
          if (!sig.tet) continue;
          entries.push({
            ts_code: sig.ts_code,
            name: poolItem?.name ?? base?.name ?? sig.ts_code,
            tech_score: base?.tech_score ?? 0,
            fundamental_score: base?.fundamental_score ?? 0,
            capital_score: base?.capital_score ?? 0,
            total_score: tetBuyScore(sig.tet),
            signals: tetReasons(sig.tet),
            next_day_adjust: base?.next_day_adjust ?? 0,
            risk_level: base?.risk_level ?? 'medium',
          });
        } else {
          if (!sig.macdv) continue;
          entries.push({
            ts_code: sig.ts_code,
            name: poolItem?.name ?? base?.name ?? sig.ts_code,
            tech_score: base?.tech_score ?? 0,
            fundamental_score: base?.fundamental_score ?? 0,
            capital_score: base?.capital_score ?? 0,
            total_score: macdvBuyScore(sig.macdv),
            signals: macdvReasons(sig.macdv),
            next_day_adjust: base?.next_day_adjust ?? 0,
            risk_level: base?.risk_level ?? 'medium',
          });
        }
      }
      entries.sort((a, b) => b.total_score - a.total_score);

      // 行业分散约束：Top 5 每个行业最多 2 只，避免过度集中
      const diversified = applySectorDiversification(entries, industryMap, limit, 2);
      const diversifiedCodes = new Set(diversified.map((r) => r.ts_code));
      finalRanked = [...diversified, ...entries.filter((r) => !diversifiedCodes.has(r.ts_code))];
    } else {
      // 资金面模式：多因子综合评分（当前评分方案）
      // 行业分散约束：Top 4 每个行业最多 2 只，避免过度集中
      // 分散后的前 4 名 + 其余按原序排列，保证 limit>4 时也能返回完整列表
      const diversified = applySectorDiversification(scored, industryMap, 4, 2);

      // 强制指定 Top 4：2026-08-25 周二调整（科技弱防御强，替换腾讯）
      // 长鑫科技(56-58进场区,评分75断层领先,严格盯54止损) + 云南白药(50-51进场区,现价49.83防御)
      // + 中国神华(45.5-46.5进场区,涨超上限不追等回踩,股息6.3%) + 立讯精密(52-53.5进场区,现价52.67★已进入)
      // 调整原因：腾讯技术分仅13、已跌破445建仓提醒线、距432止损仅1.8%，换入已在进场区的立讯精密
      // 行业分散：半导体(存储)+医药+煤炭+消费电子
      // 保留算法计算的分数/T+1/风险/理由，仅强制股票列表
      const FORCED_TOP4 = ['688825.SH', '000538.SZ', '601088.SH', '002475.SZ'];
      const forcedTop4 = FORCED_TOP4.map((code) => scored.find((s) => s.ts_code === code)).filter(
        (s): s is NonNullable<typeof s> => s !== undefined,
      );
      if (forcedTop4.length === 4) {
        diversified.length = 0; // 清空原列表
        forcedTop4.forEach((s) => diversified.push(s));
      }

      const diversifiedCodes = new Set(diversified.map((r) => r.ts_code));
      finalRanked = [...diversified, ...scored.filter((r) => !diversifiedCodes.has(r.ts_code))];
    }

    // 取前 N 名（支持分页），附加 T+1 预测与风险标签
    const recommendations = finalRanked.slice(offset, offset + limit).map((s) => ({
      ts_code: s.ts_code,
      name: s.name,
      score: s.total_score,
      tech_score: s.tech_score,
      fund_score: s.fundamental_score,
      capital_score: s.capital_score,
      next_day_adjust: s.next_day_adjust,
      risk_level: s.risk_level,
      reasons: s.signals,
    }));

    res.json({ success: true, data: recommendations, mode });
  } catch (err) {
    console.error('获取推荐失败:', err);
    res.json({ success: true, data: [] });
  }
});

/**
 * GET /api/watchlist - 回踩监控列表
 * 返回关注股票的实时价格 + 关键价位（进场区/止损位）+ 当前状态判断
 * 盘中每30秒调用都会更新结果（依赖新浪实时行情）
 * 修改 WATCHLIST 配置可调整监控股票和策略价位
 */

// 监控列表配置：策略价位可随时调整
// status 状态说明：
//   'wait'    未到进场区，继续等
//   'enter'   已进入进场区，可考虑建仓
//   'stop'    已跌破止损位，放弃
//   'chase'   涨超进场区上限，不追高
interface WatchItem {
  ts_code: string;
  name: string;
  strategy: string; // 策略说明
  entry_low: number; // 进场区下限
  entry_high: number; // 进场区上限
  stop_loss: number; // 止损位
  position_pct: number; // 建议仓位
}
const WATCHLIST: WatchItem[] = [
  {
    ts_code: '688825.SH',
    name: '长鑫科技',
    strategy: '新股上市后回调企稳，56-58回踩区，现价57.7在进场区内',
    entry_low: 56,
    entry_high: 58,
    stop_loss: 54,
    position_pct: 15,
  },
  {
    ts_code: '000538.SZ',
    name: '云南白药',
    strategy: '医药防御，50-51进场区，股息4.2%，现价50.26在进场区',
    entry_low: 50,
    entry_high: 51,
    stop_loss: 49,
    position_pct: 15,
  },
  {
    ts_code: '601088.SH',
    name: '中国神华',
    strategy: '煤炭高股息8%+蓝筹防御，45.5-46.5进场区，现价46.51在上限',
    entry_low: 45.5,
    entry_high: 46.5,
    stop_loss: 44.5,
    position_pct: 15,
  },
  {
    ts_code: '002475.SZ',
    name: '立讯精密',
    strategy: '苹果链龙头，52-53.5进场区，现价53.74涨超上限不追，对比',
    entry_low: 52,
    entry_high: 53.5,
    stop_loss: 51,
    position_pct: 15,
  },
  {
    ts_code: '00700.HK',
    name: '腾讯控股',
    strategy: '港股T+0，445-455进场区，现价453在进场区内，重点监控',
    entry_low: 445,
    entry_high: 455,
    stop_loss: 435,
    position_pct: 15,
  },
  {
    ts_code: '300502.SZ',
    name: '新易盛',
    strategy: '已跌破420进场区(现价411)，离止损410仅0.3%，放弃对比',
    entry_low: 420,
    entry_high: 430,
    stop_loss: 410,
    position_pct: 20,
  },
  {
    ts_code: '688256.SH',
    name: '寒武纪',
    strategy: '已跌破1060止损(现价1026)，放弃对比',
    entry_low: 1080,
    entry_high: 1100,
    stop_loss: 1060,
    position_pct: 15,
  },
  {
    ts_code: '300308.SZ',
    name: '中际旭创',
    strategy: '光模块龙头，等950-965回踩建仓（保留监控对比）',
    entry_low: 950,
    entry_high: 965,
    stop_loss: 930,
    position_pct: 15,
  },
];

router.get('/watchlist', async (_req: Request, res: Response): Promise<void> => {
  try {
    const codes = WATCHLIST.map((w) => w.ts_code);

    // 并行：基本面 + 新浪实时行情
    const realtimeQuotes = await getSinaRealtimeQuotes(codes).catch((err) => {
      console.error('监控列表实时行情失败:', (err as Error).message);
      return [] as Awaited<ReturnType<typeof getSinaRealtimeQuotes>>;
    });
    const realtimeMap = new Map(realtimeQuotes.map((q) => [q.ts_code, q]));

    const data = WATCHLIST.map((w) => {
      const rt = realtimeMap.get(w.ts_code);
      const price = rt?.price ?? 0;
      const changePct = rt?.pct_chg ?? 0;

      // 状态判断
      let status: 'wait' | 'enter' | 'stop' | 'chase' = 'wait';
      let statusText = '等待回踩';
      if (price <= 0) {
        status = 'wait';
        statusText = '行情获取中';
      } else if (price < w.stop_loss) {
        status = 'stop';
        statusText = '跌破止损，放弃';
      } else if (price >= w.entry_low && price <= w.entry_high) {
        status = 'enter';
        statusText = '★ 进入进场区';
      } else if (price > w.entry_high) {
        status = 'chase';
        statusText = '涨超进场区，不追';
      } else {
        status = 'wait';
        statusText = '等待回踩';
      }

      // 距进场区距离（正数=还差多少跌到进场区，负数=已进入/跌破）
      const distToEntry = price > 0 ? +(price - w.entry_high).toFixed(2) : 0;
      const distPct = price > 0 ? +((price - w.entry_high) / w.entry_high * 100).toFixed(2) : 0;

      return {
        ts_code: w.ts_code,
        name: w.name,
        price,
        change_pct: changePct,
        strategy: w.strategy,
        entry_low: w.entry_low,
        entry_high: w.entry_high,
        stop_loss: w.stop_loss,
        position_pct: w.position_pct,
        status,
        status_text: statusText,
        dist_to_entry: distToEntry,
        dist_pct: distPct,
      };
    });

    res.json({ success: true, data, updated_at: new Date().toISOString() });
  } catch (err) {
    console.error('获取监控列表失败:', err);
    res.json({ success: true, data: [] });
  }
});

/**
 * GET /api/holdings - 获取持仓记录
 * POST /api/holdings - 新增/更新持仓
 */
const HOLDINGS_FILE = join(process.cwd(), 'api', 'data', 'holdings.json');

router.get('/holdings', async (_req: Request, res: Response): Promise<void> => {
  try {
    const raw = await readFile(HOLDINGS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('读取持仓失败:', err);
    res.json({ success: true, holdings: [], updated_at: '' });
  }
});

router.post('/holdings', async (req: Request, res: Response): Promise<void> => {
  try {
    const { action, holding } = req.body as {
      action: 'add' | 'update' | 'remove';
      holding: {
        ts_code: string;
        name: string;
        buy_price: number;
        buy_date: string;
        shares: number;
        position_pct: number;
        stop_loss: number;
        take_profit: number;
        strategy: string;
        status: string;
        note?: string;
      };
    };

    const raw = await readFile(HOLDINGS_FILE, 'utf-8');
    const data = JSON.parse(raw) as { holdings: typeof holding[]; updated_at: string };

    const idx = data.holdings.findIndex((h) => h.ts_code === holding.ts_code);
    if (action === 'remove') {
      if (idx >= 0) data.holdings.splice(idx, 1);
    } else if (idx >= 0) {
      data.holdings[idx] = { ...data.holdings[idx], ...holding };
    } else {
      data.holdings.push(holding);
    }
    data.updated_at = new Date().toISOString();

    await writeFile(HOLDINGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('更新持仓失败:', err);
    res.json({ success: false, message: '更新持仓失败' });
  }
});

/**
 * POST /api/stocks/add - 添加股票到股池
 * body: { code: "300502" 或 "300502.SZ"
 */
router.post('/stocks/add', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.body as { code?: string };
    if (!code) {
      res.json({ success: false, message: '请提供股票代码' });
      return;
    }

    const tsCode = normalizeCode(code);
    if (!tsCode) {
      res.json({ success: false, message: '股票代码格式不正确' });
      return;
    }

    if (STOCK_POOL.find((s) => s.ts_code === tsCode)) {
      res.json({ success: false, message: '该股票已在股池中' });
      return;
    }

    // 从新浪实时行情获取股票名称
    let name = '';
    try {
      const quotes = await getSinaRealtimeQuotes([tsCode]);
      if (quotes.length > 0) {
        name = quotes[0].name;
      }
    } catch {
      // ignore
    }

    // 如果新浪没拿到名称,用代码占位
    if (!name) name = tsCode.split('.')[0];

    const ok = addStock(tsCode, name);
    if (!ok) {
      res.json({ success: false, message: '添加失败' });
      return;
    }

    // 清除相关缓存,确保下次查询能取到新股票
    cache.set(`sina_realtime_${tsCode}`, null, 1);
    invalidatePoolCaches();

    res.json({ success: true, data: { ts_code: tsCode, name } });
  } catch (err) {
    console.error('添加股票失败:', err);
    res.json({ success: false, message: '服务器错误' });
  }
});

/**
 * DELETE /api/stocks/:code - 从股池移除股票
 */
router.delete('/stocks/:code', (req: Request, res: Response): void => {
  try {
    const { code } = req.params;
    const ok = removeStock(code);
    if (!ok) {
      res.json({ success: false, message: '股池中未找到该股票' });
      return;
    }
    invalidatePoolCaches();
    res.json({ success: true });
  } catch (err) {
    console.error('删除股票失败:', err);
    res.json({ success: false, message: '服务器错误' });
  }
});

/* ============================================================
 * 以下为 TET(NAAIM 2025) + MACD-V(SSRN #4099617) 信号系统
 * ============================================================ */

const SETTINGS_FILE = join(process.cwd(), 'api', 'data', 'settings.json');

/** 股池变动/阈值调整后，失效全股池评分与信号缓存 */
function invalidatePoolCaches(): void {
  for (const key of ['capital_scored_all', 'pool_signals_all', 'pool_scores_all', 'pullback_status_all']) {
    cache.set(key, null, 1);
  }
}

/** 读取用户自定义 MACD-V 阈值 */
async function getMacdvConfig(): Promise<MACDVConfig> {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf-8');
    const data = JSON.parse(raw) as { macdv?: { strong?: number; extreme?: number } };
    const strong = Number(data.macdv?.strong);
    const extreme = Number(data.macdv?.extreme);
    return {
      strong: Number.isFinite(strong) && strong > 0 ? strong : DEFAULT_MACDV.strong,
      extreme: Number.isFinite(extreme) && extreme > 0 ? extreme : DEFAULT_MACDV.extreme,
    };
  } catch {
    return { ...DEFAULT_MACDV };
  }
}

/**
 * GET /api/settings - 获取信号阈值设置
 * POST /api/settings - 更新 MACD-V 自定义阈值（改变卖出/买入信号灵敏度）
 */
router.get('/settings', async (_req: Request, res: Response): Promise<void> => {
  const macdv = await getMacdvConfig();
  res.json({ success: true, data: { macdv, default: DEFAULT_MACDV } });
});

router.post('/settings', async (req: Request, res: Response): Promise<void> => {
  try {
    const { macdv } = req.body as { macdv?: { strong?: number; extreme?: number } };
    const strong = Number(macdv?.strong);
    const extreme = Number(macdv?.extreme);
    if (!Number.isFinite(strong) || !Number.isFinite(extreme) || strong < 5 || extreme <= strong || extreme > 500) {
      res.json({ success: false, message: '阈值无效：需 5 ≤ 强势阈值 < 极端阈值 ≤ 500' });
      return;
    }
    const data = {
      macdv: { strong: Math.round(strong), extreme: Math.round(extreme) },
      updated_at: new Date().toISOString(),
    };
    await writeFile(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    invalidatePoolCaches(); // 立即失效回踩状态/信号/评分缓存
    res.json({ success: true, data });
  } catch (err) {
    console.error('更新设置失败:', err);
    res.json({ success: false, message: '更新设置失败' });
  }
});

/**
 * 获取信号计算用的日K（统一升序 旧→新），并把新浪实时行情注入为当日K线，
 * 使 TET / MACD-V 盘中即可感知最新价格。
 */
async function getBarsForSignals(tsCode: string): Promise<{ bars: DailyBar[]; realtime: RealtimeQuote | null }> {
  const raw = isHK(tsCode)
    ? await getHKDailyBars(tsCode, 600)
    : await getDailyBars(tsCode, getDateNDaysAgo(800), getToday());
  // 统一升序（旧→新）
  const bars = [...raw].sort((a, b) => a.trade_date.localeCompare(b.trade_date));

  let realtime: RealtimeQuote | null = null;
  try {
    const quotes = await getSinaRealtimeQuotes([tsCode]);
    if (quotes.length > 0) realtime = quotes[0];
  } catch {
    // ignore
  }
  if (realtime && realtime.price > 0) {
    const today = getToday();
    const last = bars[bars.length - 1];
    if (last && last.trade_date === today) {
      bars[bars.length - 1] = {
        ...last,
        high: Math.max(last.high, realtime.high),
        low: Math.min(last.low, realtime.low),
        close: realtime.price,
        vol: realtime.vol,
        amount: realtime.amount,
        pct_chg: realtime.pct_chg,
        change: realtime.change,
      };
    } else if (last) {
      bars.push({
        ts_code: tsCode,
        trade_date: today,
        open: realtime.open || last.close,
        high: realtime.high || realtime.price,
        low: realtime.low || realtime.price,
        close: realtime.price,
        pre_close: realtime.pre_close || last.close,
        change: realtime.change,
        pct_chg: realtime.pct_chg,
        vol: realtime.vol,
        amount: realtime.amount,
      });
    }
  }
  return { bars, realtime };
}

/** 带并发上限的并行映射 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

/* ============================================================
 * 全股池 TET / MACD-V 信号计算与买入评分（供推荐排序与股池排序）
 * ============================================================ */

interface PoolSignal {
  ts_code: string;
  tet: TETResult | null;
  macdv: MACDVResult | null;
  note?: string;
}

/**
 * 全股池 TET + MACD-V 信号计算（注入新浪实时行情为当日K线，盘中实时）
 * 5分钟缓存，与 /api/pullback-status 共用
 */
async function getPoolSignals(): Promise<PoolSignal[]> {
  const cached = cache.get<PoolSignal[]>('pool_signals_all');
  if (cached) return cached;

  const cfg = await getMacdvConfig();
  const data = await mapLimit(STOCK_POOL, 5, async (stock): Promise<PoolSignal> => {
    try {
      const { bars } = await getBarsForSignals(stock.ts_code);
      if (bars.length < 10) {
        return { ts_code: stock.ts_code, tet: null, macdv: null, note: 'K线不足' };
      }
      return { ts_code: stock.ts_code, tet: computeTET(bars), macdv: computeMACDV(bars, cfg) };
    } catch (err) {
      console.error(`信号计算失败 ${stock.ts_code}:`, (err as Error).message);
      return { ts_code: stock.ts_code, tet: null, macdv: null, note: '计算失败' };
    }
  });
  cache.set('pool_signals_all', data, 5 * 60 * 1000);
  return data;
}

/** TET 买入评分：信号等级（good=+2/watch=+1/卖出为负）为主，Timing 连续修正，映射 0-100 */
function tetBuyScore(tet: TETResult): number {
  const level =
    (tet.buy_signal === 'good' ? 2 : tet.buy_signal === 'watch' ? 1 : 0) -
    (tet.sell_signal === 'strong' ? 2 : tet.sell_signal === 'weak' ? 1 : 0);
  const timingAdj = Math.max(-1, Math.min(1, tet.timing)) * 10;
  return Math.max(0, Math.min(100, Math.round(50 + level * 15 + timingAdj)));
}

/** MACD-V 买入评分：信号等级为主，柱状图动量方向修正，映射 0-100 */
function macdvBuyScore(macdv: MACDVResult): number {
  const level =
    (macdv.buy_signal === 'good' ? 2 : macdv.buy_signal === 'watch' ? 1 : 0) -
    (macdv.sell_signal === 'strong' ? 2 : macdv.sell_signal === 'weak' ? 1 : 0);
  const histAdj = Math.max(-10, Math.min(10, macdv.histogram * 1.5));
  return Math.max(0, Math.min(100, Math.round(50 + level * 15 + histAdj)));
}

/** TET 模式推荐卡片理由 */
function tetReasons(tet: TETResult): string[] {
  const reasons = [
    `趋势${tet.trend_score > 0 ? '+' : ''}${tet.trend_score}`,
    `情绪${tet.emotion_index > 0 ? '+' : ''}${tet.emotion_index}`,
    `Timing${tet.timing > 0 ? '+' : ''}${tet.timing}`,
  ];
  if (tet.buy_signal === 'good') reasons.push('TET买入信号');
  else if (tet.buy_signal === 'watch') reasons.push('TET可关注');
  if (tet.sell_signal === 'strong') reasons.push('趋势反转');
  else if (tet.sell_signal === 'weak') reasons.push('短期谨慎');
  return reasons;
}

/** MACD-V 模式推荐卡片理由 */
function macdvReasons(m: MACDVResult): string[] {
  const reasons = [
    `MACD-V${m.macdv > 0 ? '+' : ''}${m.macdv}`,
    m.stage_text,
    `柱${m.histogram > 0 ? '+' : ''}${m.histogram}`,
  ];
  if (m.histogram > 0 && m.prev_histogram <= 0) reasons.push('金叉');
  else if (m.histogram < 0 && m.prev_histogram >= 0) reasons.push('死叉');
  if (m.buy_signal === 'good') reasons.push('MACD-V买入信号');
  else if (m.buy_signal === 'watch') reasons.push('MACD-V可关注');
  if (m.sell_signal === 'strong') reasons.push('动量过热');
  return reasons;
}

/**
 * TET + MACD-V 综合评估：值得买入 / 建议卖出 / 不建议操作
 * 两个算法各自给出买入（good/watch/none）与卖出（strong/weak/none）信号，
 * 打分共振后输出三态结论。
 */
function computeOverall(
  tet: TETResult,
  macdv: MACDVResult,
): { verdict: 'buy' | 'sell' | 'neutral'; text: string } {
  const sellScore =
    (tet.sell_signal === 'strong' ? 2 : tet.sell_signal === 'weak' ? 1 : 0) +
    (macdv.sell_signal === 'strong' ? 2 : macdv.sell_signal === 'weak' ? 1 : 0);
  const buyScore =
    (tet.buy_signal === 'good' ? 2 : tet.buy_signal === 'watch' ? 1 : 0) +
    (macdv.buy_signal === 'good' ? 2 : macdv.buy_signal === 'watch' ? 1 : 0);

  if (sellScore >= 2) {
    return {
      verdict: 'sell',
      text: `TET与MACD-V卖出信号共振：${tet.sell_reason}；${macdv.sell_reason}`,
    };
  }
  if (buyScore >= 3) {
    return {
      verdict: 'buy',
      text: `TET与MACD-V买入信号共振：${tet.buy_reason}；${macdv.buy_reason}`,
    };
  }
  if (buyScore >= 2 && sellScore === 0) {
    return {
      verdict: 'buy',
      text: `偏多信号：${tet.buy_reason}；${macdv.buy_reason}，可轻仓尝试`,
    };
  }
  return {
    verdict: 'neutral',
    text: 'TET与MACD-V信号方向不一致或强度不足，不建议进行操作，保持观望',
  };
}

/**
 * 持仓股三态建议融合：10项卖出机制（风控）优先，其次 TET+MACD-V 共振。
 * 与 computeOverall 输出同一三态口径（买入/不动/卖出），
 * 保证"我的持仓"列表与详情面板综合评估前后一致。
 */
function mergeHoldingOverall(
  overall: { verdict: 'buy' | 'sell' | 'neutral'; text: string },
  sell: ReturnType<typeof computeSellSignals>,
): { verdict: 'buy' | 'sell' | 'neutral'; text: string } {
  // 卖出机制触发减持/强烈卖出，或 TET+MACD-V 共振卖出 → 卖出
  if (sell.advice === 'strong_sell' || sell.advice === 'reduce' || overall.verdict === 'sell') {
    return { verdict: 'sell', text: sell.advice_text };
  }
  // 无任何卖出信号且技术上偏多 → 买入（可持有/加仓）
  if (overall.verdict === 'buy' && sell.weak_count === 0) {
    return { verdict: 'buy', text: overall.text };
  }
  // 偏多但出现弱卖出信号 → 不动（不宜加仓）
  if (overall.verdict === 'buy') {
    return {
      verdict: 'neutral',
      text: `技术上偏多但已触发 ${sell.weak_count} 个弱卖出信号，不宜加仓；${overall.text}`,
    };
  }
  return overall;
}

/**
 * GET /api/pullback-status - 全部股池股票的回踩状态（仅两态：值得回踩 / 不入场）
 * 依据 TET 买入信号 + MACD-V 买入信号，整表缓存 5 分钟
 * 附 score：TET+MACD-V 各50%权重综合评分 [-1,1]，越高越值得买入，供前端排序
 * 附 bagholder：韭菜50第三信号两态（'sell'=进入Top50避雷名单 / 'none'=无信号），港股恒为 'none'
 */
router.get('/pullback-status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const cached = cache.get<unknown[]>('pullback_status_all');
    if (cached) {
      res.json({ success: true, data: cached, updated_at: new Date().toISOString(), cached: true });
      return;
    }
    // 韭菜50名单（失败不阻塞回踩状态，仅缺失该列数据）
    let bagholder: Awaited<ReturnType<typeof getBagholder50>> | null = null;
    try {
      bagholder = await getBagholder50();
    } catch {
      bagholder = null;
    }
    const bagholderOf = (tsCode: string) => {
      if (!bagholder || isHK(tsCode)) return { bagholder: 'none' as const };
      const inList = bagholder.top50.some((c) => c.ts_code === tsCode);
      const s = bagholder.scores[tsCode];
      const rank = bagholder.ranks[tsCode];
      return {
        bagholder: inList ? ('sell' as const) : ('none' as const),
        bagholder_score: s ?? null,
        bagholder_percentile: s !== undefined && rank !== undefined
          ? +((rank / bagholder.valid_count) * 100).toFixed(1)
          : null,
      };
    };
    const data = (await getPoolSignals()).map((sig) => {
      const bh = bagholderOf(sig.ts_code);
      if (!sig.tet || !sig.macdv) {
        return { ts_code: sig.ts_code, status: 'no' as const, note: sig.note ?? '无数据', score: -1, ...bh };
      }
      const tet = sig.tet;
      const macdv = sig.macdv;
      const ok = tet.buy_signal === 'good' || macdv.buy_signal === 'good';
      // 综合评分：TET 与 MACD-V 各 50% 权重，信号等级映射 [买入good=+2/watch=+1/none=0，卖出strong=-2/weak=-1]，归一化到 [-1,1]
      const tetLevel =
        (tet.buy_signal === 'good' ? 2 : tet.buy_signal === 'watch' ? 1 : 0) -
        (tet.sell_signal === 'strong' ? 2 : tet.sell_signal === 'weak' ? 1 : 0);
      const macdvLevel =
        (macdv.buy_signal === 'good' ? 2 : macdv.buy_signal === 'watch' ? 1 : 0) -
        (macdv.sell_signal === 'strong' ? 2 : macdv.sell_signal === 'weak' ? 1 : 0);
      const score = +((tetLevel / 2) * 0.5 + (macdvLevel / 2) * 0.5).toFixed(3);
      return {
        ts_code: sig.ts_code,
        status: ok ? ('ok' as const) : ('no' as const),
        score,
        tet_trend: tet.trend_score,
        emotion: tet.emotion_index,
        anchored: tet.anchored_trend,
        timing: tet.timing,
        macdv: macdv.macdv,
        stage: macdv.stage,
        ...bh,
      };
    });
    cache.set('pullback_status_all', data, 5 * 60 * 1000);
    res.json({ success: true, data, updated_at: new Date().toISOString() });
  } catch (err) {
    console.error('获取回踩状态失败:', err);
    res.json({ success: true, data: [] });
  }
});

/**
 * GET /api/pool-scores - 全股池四种排序评分（自选股池排序用）
 * total_score=资金面综合(当前评分方案) / fund_score=基本面 / tet_score=TET / macdv_score=MACD-V
 * 分数越高越值得买入，越低越值得卖出；60秒缓存
 */
router.get('/pool-scores', async (_req: Request, res: Response): Promise<void> => {
  try {
    const cached = cache.get<unknown[]>('pool_scores_all');
    if (cached) {
      res.json({ success: true, data: cached, updated_at: new Date().toISOString(), cached: true });
      return;
    }
    const [scored, signals] = await Promise.all([getCapitalScored(), getPoolSignals()]);
    const scoreMap = new Map(scored.map((s) => [s.ts_code, s]));
    const signalMap = new Map(signals.map((s) => [s.ts_code, s]));
    const data = STOCK_POOL.map((stock) => {
      const base = scoreMap.get(stock.ts_code);
      const sig = signalMap.get(stock.ts_code);
      return {
        ts_code: stock.ts_code,
        total_score: base?.total_score ?? null, // 资金面综合（当前评分方案）
        tech_score: base?.tech_score ?? null,
        fund_score: base?.fundamental_score ?? null, // 基本面
        capital_score: base?.capital_score ?? null,
        tet_score: sig?.tet ? tetBuyScore(sig.tet) : null,
        macdv_score: sig?.macdv ? macdvBuyScore(sig.macdv) : null,
      };
    });
    cache.set('pool_scores_all', data, 60 * 1000);
    res.json({ success: true, data, updated_at: new Date().toISOString() });
  } catch (err) {
    console.error('获取股池评分失败:', err);
    res.json({ success: true, data: [] });
  }
});

/**
 * GET /api/bagholder50 - 韭菜50避雷名单（冷西西韭菜50指数算法复刻，第三信号）
 * 四因子（追涨热度/换手放大/龙虎榜注意力/特大单流量）横截面百分位等权合成，
 * 选出A股市值前1000中最易跑输的 Top50，按韭菜分从高到低展示。
 * 本地化增量存储：首次全量构建后每日仅增量追加，名单由本地数据毫秒级计算。
 * 进入选中名单 = 卖出信号（两态：sell / none）。数据未齐备时 fail-closed 返回失败。
 */
router.get('/bagholder50', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await getBagholder50();
    res.json({
      success: true,
      data: {
        signal_date: result.signal_date,
        entry_date: result.entry_date,
        generated_at: result.generated_at,
        universe_count: result.universe_count,
        valid_count: result.valid_count,
        top50: result.top50,
      },
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('获取韭菜50名单失败:', (err as Error).message);
    res.json({ success: false, message: `韭菜50名单生成失败：${(err as Error).message}（数据未齐备时不降级，fail-closed）` });
  }
});

/**
 * GET /api/stocks/:code/signals - 个股买入信号详情
 * TET 专栏 + MACD-V 买入判断 + 是否可追涨 + 当日主力资金流入
 */
router.get('/stocks/:code/signals', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.params;
    const cfg = await getMacdvConfig();
    const { bars, realtime } = await getBarsForSignals(code);

    const poolItem = STOCK_POOL.find((s) => s.ts_code === code);
    const watchItem = WATCHLIST.find((w) => w.ts_code === code);
    const name = poolItem?.name ?? watchItem?.name ?? realtime?.name ?? code;
    const price = realtime?.price ?? (bars.length > 0 ? bars[bars.length - 1].close : 0);
    const pctChg = realtime?.pct_chg ?? (bars.length > 0 ? bars[bars.length - 1].pct_chg : 0);

    if (bars.length < 10) {
      res.json({ success: false, message: 'K线数据不足，无法计算信号' });
      return;
    }

    const tet = computeTET(bars);
    const macdv = computeMACDV(bars, cfg);

    // 韭菜50第三信号（A股市值前1000池内股票；进入Top50=强卖出避雷；获取失败不阻塞主信号）
    let bagholder: BagholderStockStatus | null = null;
    if (!isHK(code)) {
      try {
        bagholder = await getBagholderStatus(code);
      } catch {
        bagholder = null;
      }
    }
    const bagholderSignal: BagholderSignalInput | null = bagholder && bagholder.available ? bagholder : null;

    // TET + MACD-V + 韭菜50 综合评估：买入 / 不动 / 卖出
    let overall = computeOverall(tet, macdv);
    if (bagholderSignal?.in_list) {
      overall = {
        verdict: 'sell',
        text: `${overall.text}；韭菜50第三信号：${bagholderSignal.signal_text}`,
      };
    }

    // 若该股票在"我的持仓"中，附带11项卖出机制评估（含韭菜50避雷），并将综合建议融合为三态口径
    let holdingSell: ReturnType<typeof computeSellSignals> | null = null;
    let holdingHighest = 0;
    let holdingInfo: Record<string, unknown> | null = null;
    try {
      const raw = await readFile(HOLDINGS_FILE, 'utf-8');
      const hs = (JSON.parse(raw).holdings ?? []) as { ts_code: string; buy_price: number; buy_date: string; shares: number }[];
      const h = hs.find((x) => x.ts_code === code);
      if (h) {
        const buyDateCompact = (h.buy_date ?? '').replace(/-/g, '');
        const sinceBuy = buyDateCompact
          ? bars.filter((b) => b.trade_date >= buyDateCompact)
          : bars.slice(-120);
        const rangeBars = sinceBuy.length > 0 ? sinceBuy : bars.slice(-120);
        holdingHighest = rangeBars.reduce((m, b) => Math.max(m, b.high), 0);
        holdingSell = computeSellSignals(bars, price, holdingHighest, tet, macdv, bagholderSignal);
        overall = mergeHoldingOverall(overall, holdingSell);
        holdingInfo = { buy_price: h.buy_price, shares: h.shares, buy_date: h.buy_date };
      }
    } catch {
      // 持仓文件不存在或读取失败，忽略
    }

    // 主力资金流（大单+超大单净额，万元）：当日优先，数据未发布则向历史回退最多5个交易日；港股无数据
    let mainInflowWan: number | null = null;
    if (!isHK(code)) {
      const dates = [getToday(), ...bars.slice(-6).map((b) => b.trade_date).reverse()];
      for (const d of dates) {
        const mf = await getMoneyFlow(code, d);
        if (mf) {
          mainInflowWan =
            (mf.buy_lg_amount + mf.buy_elg_amount) - (mf.sell_lg_amount + mf.sell_elg_amount);
          break;
        }
      }
    }

    const buy = computeBuySignals(bars, price, tet, macdv, mainInflowWan, isHK(code));

    // A+H 两地上市公司：附 AH 比价与税务视角的买入建议（非 AH 股为 null，失败不影响主信号）
    let ahCompare: AHComparison | null = null;
    try {
      ahCompare = await getAHComparison(code);
    } catch {
      ahCompare = null;
    }

    // 配置过进场区的股票附带价位状态
    let entryZone: Record<string, unknown> | null = null;
    if (watchItem) {
      let zoneText = '';
      if (price > 0 && price < watchItem.stop_loss) zoneText = '已跌破止损位，放弃';
      else if (price >= watchItem.entry_low && price <= watchItem.entry_high) zoneText = '当前在进场区内';
      else if (price > watchItem.entry_high) zoneText = '已涨超进场区上限';
      else zoneText = '尚未回到进场区';
      entryZone = {
        entry_low: watchItem.entry_low,
        entry_high: watchItem.entry_high,
        stop_loss: watchItem.stop_loss,
        position_pct: watchItem.position_pct,
        strategy: watchItem.strategy,
        zone_text: zoneText,
      };
    }

    res.json({
      success: true,
      data: {
        ts_code: code,
        name,
        market: isHK(code) ? 'HK' : 'A',
        price,
        pct_chg: pctChg,
        overall,
        tet,
        macdv,
        buy,
        bagholder: bagholderSignal,
        ah_compare: ahCompare,
        entry_zone: entryZone,
        macdv_config: cfg,
        bars_count: bars.length,
        holding: holdingInfo ? { ...holdingInfo, highest: holdingHighest, sell: holdingSell } : null,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('获取个股信号失败:', err);
    res.json({ success: false, message: '获取个股信号失败' });
  }
});

/**
 * GET /api/holdings/signals - 持仓卖出信号系统
 * 对每只持仓计算：TET 趋势/情绪 + MACD-V(自定义阈值) + 10项卖出机制 + 综合建议
 * 附实时价格，供前端计算盈亏（支持不在股池中的持仓）
 */
router.get('/holdings/signals', async (_req: Request, res: Response): Promise<void> => {
  try {
    const cfg = await getMacdvConfig();
    let holdings: {
      ts_code: string;
      name: string;
      buy_price: number;
      buy_date: string;
      shares: number;
    }[] = [];
    try {
      const raw = await readFile(HOLDINGS_FILE, 'utf-8');
      holdings = (JSON.parse(raw).holdings ?? []) as typeof holdings;
    } catch {
      holdings = [];
    }

    const data = await mapLimit(holdings, 3, async (h) => {
      try {
        const { bars, realtime } = await getBarsForSignals(h.ts_code);
        const price = realtime?.price ?? (bars.length > 0 ? bars[bars.length - 1].close : 0);
        const pctChg = realtime?.pct_chg ?? (bars.length > 0 ? bars[bars.length - 1].pct_chg : 0);

        if (bars.length < 10) {
          return { ts_code: h.ts_code, name: h.name, price, pct_chg: pctChg, market: isHK(h.ts_code) ? 'HK' : 'A', error: 'K线数据不足' };
        }

        // 持仓期最高价（移动止盈基准）
        const buyDateCompact = (h.buy_date ?? '').replace(/-/g, '');
        const sinceBuy = buyDateCompact
          ? bars.filter((b) => b.trade_date >= buyDateCompact)
          : bars.slice(-120);
        const rangeBars = sinceBuy.length > 0 ? sinceBuy : bars.slice(-120);
        const highest = rangeBars.reduce((m, b) => Math.max(m, b.high), 0);

        const tet = computeTET(bars);
        const macdv = computeMACDV(bars, cfg);
        // 韭菜50第三信号（A股市值前1000池内股票；获取失败不阻塞主信号）
        let bagholderSignal: BagholderSignalInput | null = null;
        if (!isHK(h.ts_code)) {
          try {
            const bh = await getBagholderStatus(h.ts_code);
            bagholderSignal = bh.available ? bh : null;
          } catch {
            bagholderSignal = null;
          }
        }
        const sell = computeSellSignals(bars, price, highest, tet, macdv, bagholderSignal);
        // 三态建议（买入/不动/卖出）：卖出机制优先（含韭菜50避雷），其次 TET+MACD-V 共振，与详情面板口径一致
        const overall = mergeHoldingOverall(computeOverall(tet, macdv), sell);

        return {
          ts_code: h.ts_code,
          name: h.name,
          price,
          pct_chg: pctChg,
          market: isHK(h.ts_code) ? 'HK' : 'A',
          highest,
          buy_date: h.buy_date,
          overall,
          tet,
          macdv,
          sell,
          bagholder: bagholderSignal,
        };
      } catch (err) {
        console.error(`持仓信号计算失败 ${h.ts_code}:`, (err as Error).message);
        return { ts_code: h.ts_code, name: h.name, price: 0, pct_chg: 0, market: isHK(h.ts_code) ? 'HK' : 'A', error: '计算失败' };
      }
    });

    res.json({ success: true, data, macdv_config: cfg, updated_at: new Date().toISOString() });
  } catch (err) {
    console.error('获取持仓信号失败:', err);
    res.json({ success: true, data: [] });
  }
});

/**
 * GET /api/stocks/search?q= - 按名称/代码/拼音搜索股票（A股+港股）
 * 用于"我的持仓"输入栏；数据源：腾讯智能搜索 + 本地股池匹配
 */
router.get('/stocks/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.json({ success: true, data: [] });
      return;
    }

    const results: { ts_code: string; name: string; market: 'A' | 'HK' }[] = [];

    // 1) 本地股池匹配（名称/代码）
    const upper = q.toUpperCase();
    for (const s of STOCK_POOL) {
      if (s.name.includes(q) || s.ts_code.toUpperCase().includes(upper)) {
        results.push({ ts_code: s.ts_code, name: s.name, market: isHK(s.ts_code) ? 'HK' : 'A' });
      }
    }

    // 2) 腾讯智能搜索（支持中文名/拼音/代码，覆盖全部A股+港股）
    try {
      const url = `https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(q)}&t=all`;
      const resp = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      });
      const text = iconv.decode(Buffer.from(resp.data), 'gbk');
      const m = text.match(/v_hint="([^"]*)"/);
      if (m && m[1]) {
        for (const item of m[1].split('^')) {
          const parts = item.split('~');
          if (parts.length < 5) continue;
          const [market, code, name, , type] = parts;
          if (!type.startsWith('GP')) continue; // 仅股票（GP-A A股 / GP 港股），排除基金债券
          let tsCode = '';
          if (market === 'hk') tsCode = `${code.padStart(5, '0')}.HK`;
          else if (market === 'sh') tsCode = `${code}.SH`;
          else if (market === 'sz') tsCode = `${code}.SZ`;
          if (!tsCode) continue;
          if (!results.find((r) => r.ts_code === tsCode)) {
            results.push({ ts_code: tsCode, name, market: market === 'hk' ? 'HK' : 'A' });
          }
        }
      }
    } catch (err) {
      console.error('腾讯搜索失败:', (err as Error).message);
    }

    res.json({ success: true, data: results.slice(0, 10) });
  } catch (err) {
    console.error('搜索股票失败:', err);
    res.json({ success: true, data: [] });
  }
});

export default router;
