import { getAHComparison } from '../ahCompare.js';
import { getBagholderStatus } from '../bagholder.js';
import { computeMACDV, computeTET } from '../indicators.js';
import { getHKBasics, getHKDailyBars, getHKQuotes } from '../hkQuotes.js';
import { isHK, getSinaRealtimeQuote } from '../realtime.js';
import { normalizeCode, STOCK_POOL } from '../stockPool.js';
import { getDailyBars, getDailyBasic, getDateNDaysAgo, getMoneyFlow, getToday, getTop10Holders, type DailyBar } from '../tushare.js';
import type { EvidenceRecord, EvidenceStatus, EvidenceValueKind, FinanceSnapshot } from './types.js';

function now(): string {
  return new Date().toISOString();
}

function evidence(
  id: string,
  title: string,
  source: string,
  status: EvidenceStatus,
  valueKind: EvidenceValueKind,
  data?: unknown,
  note?: string,
  asOf: string | null = null,
): EvidenceRecord {
  return { id, title, source, status, valueKind, asOf, retrievedAt: now(), note, data };
}

async function attempt<T>(
  id: string,
  title: string,
  source: string,
  valueKind: EvidenceValueKind,
  task: () => Promise<T>,
  toEvidence: (value: T) => { data: unknown; status?: EvidenceStatus; note?: string; asOf?: string | null },
): Promise<EvidenceRecord> {
  try {
    const result = toEvidence(await task());
    return evidence(id, title, source, result.status ?? 'available', valueKind, result.data, result.note, result.asOf ?? null);
  } catch {
    return evidence(id, title, source, 'error', valueKind, undefined, '数据源暂时不可用，未据此形成结论。');
  }
}

function compactBars(bars: DailyBar[]): Record<string, unknown> {
  const latest = bars[bars.length - 1];
  const previous = bars[bars.length - 2];
  const recentVolumes = bars.slice(-21, -1).map((bar) => bar.vol);
  const averageVolume = recentVolumes.length
    ? recentVolumes.reduce((total, value) => total + value, 0) / recentVolumes.length
    : 0;
  return {
    bars: bars.length,
    latest: latest ? {
      tradeDate: latest.trade_date,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      pctChg: latest.pct_chg,
      volume: latest.vol,
      amount: latest.amount,
    } : null,
    return20d: latest && bars.length >= 21 && bars[bars.length - 21].close > 0
      ? Number(((latest.close / bars[bars.length - 21].close - 1) * 100).toFixed(2)) : null,
    volumeRatio20d: latest && averageVolume > 0 ? Number((latest.vol / averageVolume).toFixed(2)) : null,
    previousTradeDate: previous?.trade_date ?? null,
  };
}

export interface FinanceGatewayResult {
  snapshot: FinanceSnapshot;
  bars: DailyBar[];
}

/** Read-only financial evidence boundary for the model prompt. */
export async function buildFinanceSnapshot(rawCode?: string): Promise<FinanceGatewayResult> {
  const code = rawCode ? normalizeCode(rawCode) : null;
  const generatedAt = now();
  if (!code) {
    return {
      snapshot: {
        code: null,
        name: null,
        market: 'unknown',
        generatedAt,
        evidence: [evidence('E1', '标的代码', '应用校验', 'unavailable', 'context', undefined, '请提供 A 股或港股代码。')],
      },
      bars: [],
    };
  }

  const hk = isHK(code);
  const market = hk ? 'HK' : 'A';
  const poolItem = STOCK_POOL.find((stock) => stock.ts_code === code);
  const barsTask = (hk ? getHKDailyBars(code, 640) : getDailyBars(code, getDateNDaysAgo(1000), getToday())).catch(() => [] as DailyBar[]);
  const [bars, quoteEvidence, basicEvidence, ahEvidence, bagholderEvidence] = await Promise.all([
    barsTask,
    attempt(
      'E2', '实时行情', hk ? '腾讯财经' : '新浪财经', 'reported',
      async () => hk ? (await getHKQuotes([code])).get(code) ?? null : getSinaRealtimeQuote(code),
      (quote) => quote
        ? { data: quote, asOf: 'trade_date' in quote ? String(quote.trade_date ?? '') || null : null }
        : { data: null, status: 'unavailable', note: '实时行情未返回，使用日线数据时会明确说明。' },
    ),
    attempt(
      'E4', '估值与交易指标', hk ? '腾讯财经' : 'Tushare daily_basic', hk ? 'estimated' : 'reported',
      async () => hk ? (await getHKBasics([code])).get(code) ?? null : getDailyBasic(code, getToday()),
      (basic) => basic
        ? { data: basic, asOf: basic.trade_date, ...(hk ? { status: 'partial' as const, note: '港股 PE TTM 使用行情 PE 近似，PS 未提供；字段中的 0 可能表示缺失。市值单位为万元，币种为港元。' } : {}) }
        : { data: null, status: 'unavailable', note: '未取得最新估值指标。' },
    ),
    attempt(
      'E7', 'A/H 比价', '应用 A/H 比价服务', 'calculated',
      () => getAHComparison(code),
      (comparison) => comparison
        ? { data: {
          a_code: comparison.a_code, h_code: comparison.h_code,
          a_price: comparison.a_price, h_price: comparison.h_price, h_price_cny: comparison.h_price_cny,
          fx_rate: comparison.fx_rate, fx_source: comparison.fx_source,
          a_premium: comparison.a_premium, h_a_ratio: comparison.h_a_ratio,
        }, status: comparison.fx_source === '近似汇率' ? 'partial' : 'available',
        note: comparison.fx_source === '近似汇率' ? '汇率为固定近似值，比价仅供估算；未核验当前税费。' : 'A/H 为不同市场证券，不可直接互换；未核验当前税费。' }
        : { data: null, status: 'unavailable', note: '该标的不是可用的 A+H 配对，或行情不足。' },
    ),
    attempt(
      'E8', '拥挤度风险', '韭菜50模型', 'calculated',
      () => getBagholderStatus(code, true),
      (status) => status.available
        ? { data: status, asOf: status.signal_date }
        : { data: status, status: 'unavailable', note: status.signal_text },
    ),
  ]);

  const barsEvidence = evidence(
    'E3', '历史行情与成交量', hk ? '腾讯财经日线' : 'Tushare daily',
    bars.length ? (hk ? 'partial' : 'available') : 'unavailable', hk ? 'estimated' : 'reported', compactBars(bars),
    bars.length ? (hk ? '港股成交额由成交量乘收盘价估算；不是交易所报告的真实成交额。' : '日线为未复权价格，跨分红送转的收益和趋势可能失真。') : '没有取得有效日线数据。', bars[bars.length - 1]?.trade_date ?? null,
  );
  const signalEvidence = bars.length >= 2
    ? evidence('E5', '趋势与动量', 'TET / MACD-V', bars.length < 550 ? 'partial' : 'available', 'calculated', {
      tet: computeTET(bars), macdv: computeMACDV(bars), bars: bars.length,
    }, bars.length < 550 ? '不足 550 根日线，长期趋势覆盖受限；指标不构成确定性买卖结论。' : '指标为历史价格计算结果；需结合复权口径和数据时点。', bars[bars.length - 1]?.trade_date ?? null)
    : evidence('E5', '趋势与动量', 'TET / MACD-V', 'unavailable', 'calculated', undefined, '日线不足，未计算指标。');

  const holderAndFlowEvidence = hk
    ? evidence('E6', '股东与资金流', 'Tushare', 'unavailable', 'reported', undefined, '当前 A 股资金流与十大股东接口不适用于港股。')
    : await attempt(
      'E6', '股东与资金流', 'Tushare top10_holders / moneyflow', 'reported',
      async () => {
        const tradeDate = bars[bars.length - 2]?.trade_date ?? bars[bars.length - 1]?.trade_date;
        const [holders, moneyFlow] = await Promise.all([
          getTop10Holders(code),
          tradeDate ? getMoneyFlow(code, tradeDate) : Promise.resolve(null),
        ]);
        const latestPeriod = holders.reduce((latest, holder) => holder.end_date > latest ? holder.end_date : latest, '');
        return { holders: holders.filter((holder) => holder.end_date === latestPeriod).slice(0, 10), latestPeriod, moneyFlow };
      },
      (result) => ({
        data: result,
        status: result.holders.length || result.moneyFlow ? 'available' : 'empty',
        note: result.holders.length || result.moneyFlow ? undefined : '数据源没有返回当前可用记录。',
        asOf: result.moneyFlow?.trade_date ?? (result.latestPeriod || null),
      }),
    );

  const unavailableNewsEvidence = evidence(
    'E9', '新闻与公告', 'Tushare', 'unavailable', 'reported', undefined,
    '当前账户/接口未提供可核验的新闻公告数据，回答不会把未经核验的消息当作事实。',
  );
  return {
    snapshot: {
      code,
      name: poolItem?.name ?? null,
      market,
      generatedAt,
      evidence: [quoteEvidence, barsEvidence, basicEvidence, signalEvidence, holderAndFlowEvidence, ahEvidence, bagholderEvidence, unavailableNewsEvidence],
    },
    bars,
  };
}
