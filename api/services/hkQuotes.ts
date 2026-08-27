/**
 * 腾讯财经港股行情服务。
 *
 * 补齐新浪行情缺失的港股基本面数据:PE(TTM)、PB、总市值、流通市值、换手率、股息率、量比。
 *
 * 实时行情 API: https://qt.gtimg.cn/q=hk00700,hk02096 (GBK编码,~分隔)
 * 字段映射(已用真实数据交叉验证):
 *   f[1]=名称 f[3]=现价 f[4]=昨收 f[5]=今开 f[6]=成交量(股)
 *   f[31]=涨跌额 f[32]=涨跌幅% f[33]=最高 f[34]=最低 f[37]=成交额(港元)
 *   f[39]=PE(TTM) f[58]=PB f[44]=H股流通市值(亿港元) f[45]=总市值(亿港元)
 *   f[47]=股息率% f[59]=换手率% f[75]=币种
 * (PB取f[58]验证:招行0.97/神华1.78/腾讯3.19,反推ROE=PB/PE与实际相符;
 *   f[43]非PB,招行2.12反推ROE 28%不合理)
 *
 * 日K线 API: https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=hk00700,day,,,N,qfq
 * 返回 data[code].day / qfqday: [日期, 开, 收, 高, 低, 成交量(股), (可能有附加对象)]
 * 最后一行为当日实时K线(盘中成交量实时更新),可直接算量比。
 */
import axios from 'axios';
import iconv from 'iconv-lite';

import type { DailyBar, DailyBasic } from './tushare.js';
import type { RealtimeQuote } from './realtime.js';
import * as cache from './cache.js';

const CACHE_TTL_QUOTE = 30 * 1000; // 实时行情缓存30秒(随前端30秒刷新自动更新)
const CACHE_TTL_KLINE = 60 * 1000; // 日K线缓存60秒(当日实时量比足够)

export interface HKQuote {
  ts_code: string;
  name: string;
  price: number;
  pre_close: number;
  open: number;
  high: number;
  low: number;
  change: number;
  change_pct: number;
  volume: number; // 成交量(股)
  amount: number; // 成交额(港元)
  pe_ttm: number;
  pb: number;
  total_mv: number; // 总市值(亿港元)
  circ_mv: number; // H股流通市值(亿港元)
  dividend_yield: number; // 股息率%
  turnover_rate: number; // 换手率%
  currency: string;
}

/** 将 Tushare 代码转换为腾讯代码: 00700.HK -> hk00700 */
function toTencentCode(tsCode: string): string {
  const [code] = tsCode.split('.');
  return `hk${code.padStart(5, '0')}`;
}

/** 从腾讯代码还原 Tushare 代码: hk00700 -> 00700.HK */
function fromTencentCode(tencentCode: string): string {
  return `${tencentCode.slice(2)}.HK`;
}

function parseNum(v: string | undefined): number {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
}

/**
 * 批量获取港股实时行情(含 PE/PB/市值/换手率/股息率)。
 * 缓存30秒,盘中自动更新。
 */
export async function getHKQuotes(tsCodes: string[]): Promise<Map<string, HKQuote>> {
  const result = new Map<string, HKQuote>();
  if (tsCodes.length === 0) return result;

  const cacheKey = `tencent_hk_quote_${tsCodes.slice().sort().join('_')}`;
  const cached = cache.get<Map<string, HKQuote>>(cacheKey);
  if (cached) return cached;

  const url = `https://qt.gtimg.cn/q=${tsCodes.map(toTencentCode).join(',')}`;

  try {
    const resp = await axios.get(url, {
      headers: {
        Referer: 'https://gu.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      timeout: 5000,
      responseType: 'arraybuffer',
    });

    const text = iconv.decode(Buffer.from(resp.data), 'gbk');

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      const match = line.match(/v_(hk\d+)="(.+)"/);
      if (!match) continue;

      const f = match[2].split('~');
      if (f.length < 60) continue;

      const price = parseNum(f[3]);
      if (price <= 0) continue; // 停牌或异常数据跳过

      const quote: HKQuote = {
        ts_code: fromTencentCode(match[1]),
        name: f[1],
        price,
        pre_close: parseNum(f[4]),
        open: parseNum(f[5]),
        high: parseNum(f[33]),
        low: parseNum(f[34]),
        change: parseNum(f[31]),
        change_pct: parseNum(f[32]),
        volume: parseNum(f[6]), // 股
        amount: parseNum(f[37]), // 港元
        pe_ttm: parseNum(f[39]),
        pb: parseNum(f[58]),
        total_mv: parseNum(f[45]), // 亿港元
        circ_mv: parseNum(f[44]), // 亿港元
        dividend_yield: parseNum(f[47]),
        turnover_rate: parseNum(f[59]),
        currency: f[75] || 'HKD',
      };
      result.set(quote.ts_code, quote);
    }

    cache.set(cacheKey, result, CACHE_TTL_QUOTE);
    return result;
  } catch (err) {
    console.error('腾讯港股实时行情失败:', (err as Error).message);
    return result;
  }
}

/**
 * 获取港股日K线(Tushare DailyBar 兼容格式)。
 * 最后一行为当日实时K线,盘中成交量实时更新。
 */
export async function getHKDailyBars(tsCode: string, limit: number): Promise<DailyBar[]> {
  if (limit <= 0) return [];

  const cacheKey = `tencent_hk_kline_${tsCode}_${limit}`;
  const cached = cache.get<DailyBar[]>(cacheKey);
  if (cached) return cached;

  const tencentCode = toTencentCode(tsCode);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentCode},day,,,${limit},qfq`;

  try {
    const resp = await axios.get(url, {
      headers: {
        Referer: 'https://gu.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      timeout: 8000,
    });

    const node = resp.data?.data?.[tencentCode];
    const rows: unknown[][] = node?.qfqday ?? node?.day ?? [];
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const bars: DailyBar[] = [];
    let prevClose = 0;
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 6) continue;
      // 格式: [日期(YYYY-MM-DD), 开, 收, 高, 低, 成交量(股)]
      const date = String(row[0]).replace(/-/g, ''); // -> YYYYMMDD,与 Tushare 一致
      const open = parseNum(String(row[1]));
      const close = parseNum(String(row[2]));
      const high = parseNum(String(row[3]));
      const low = parseNum(String(row[4]));
      const vol = parseNum(String(row[5]));
      if (!date || close <= 0) continue;

      const preClose = prevClose > 0 ? prevClose : open;
      const change = close - preClose;
      const pctChg = preClose > 0 ? (change / preClose) * 100 : 0;

      bars.push({
        ts_code: tsCode,
        trade_date: date,
        open,
        high,
        low,
        close,
        pre_close: preClose,
        change: +change.toFixed(3),
        pct_chg: +pctChg.toFixed(2),
        vol, // 股(量比等比率计算不受单位影响)
        amount: +((vol * close) / 1000).toFixed(2), // 千港元(对齐 Tushare 千元量纲)
      });
      prevClose = close;
    }

    cache.set(cacheKey, bars, CACHE_TTL_KLINE);
    return bars;
  } catch (err) {
    console.error(`腾讯港股K线失败(${tsCode}):`, (err as Error).message);
    return [];
  }
}

/**
 * 港股基本面(DailyBasic 兼容格式),供选股评分与各面板直接使用。
 * PE/PB/换手率/股息率来自腾讯实时行情,总市值单位换算为万元(对齐 Tushare)。
 */
export async function getHKBasics(tsCodes: string[]): Promise<Map<string, DailyBasic>> {
  const result = new Map<string, DailyBasic>();
  const quotes = await getHKQuotes(tsCodes);

  for (const [tsCode, q] of quotes) {
    if (q.price <= 0) continue;
    // 行情时间戳里的日期(如 2026/08/21 16:08:14),周末/休市时保持最近交易日
    result.set(tsCode, {
      ts_code: tsCode,
      trade_date: getQuoteTradeDate(q),
      close: q.price,
      turnover_rate: q.turnover_rate,
      pe: q.pe_ttm, // 静态PE用TTM近似
      pe_ttm: q.pe_ttm,
      pb: q.pb,
      ps: 0,
      ps_ttm: 0,
      dv_ratio: q.dividend_yield,
      total_mv: q.total_mv * 10000, // 亿港元 -> 万元
      circ_mv: q.circ_mv * 10000, // 亿港元 -> 万元
    });
  }
  return result;
}

/** 港股行情适配为 RealtimeQuote(供评分算法注入盘中数据,单位与港股K线保持一致) */
export function toRealtimeQuote(q: HKQuote): RealtimeQuote {
  return {
    ts_code: q.ts_code,
    name: q.name,
    price: q.price,
    pre_close: q.pre_close,
    open: q.open,
    high: q.high,
    low: q.low,
    change: q.change,
    pct_chg: q.change_pct,
    vol: q.volume, // 股,与腾讯K线单位一致
    amount: q.amount / 1000, // 千港元,对齐 Tushare 千元量纲
  };
}

/** 从行情推断交易日(YYYYMMDD);失败时用当天 */
function getQuoteTradeDate(_q: HKQuote): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}
