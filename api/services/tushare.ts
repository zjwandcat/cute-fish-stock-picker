import axios from 'axios';
import * as cache from './cache.js';

const TUSHARE_API_URL = 'https://api.tushare.pro';

function getToken(): string {
  return process.env.TUSHARE_TOKEN || '';
}

// 缓存 TTL
const CACHE_TTL_DAILY = 5 * 60 * 1000; // K线 5分钟
const CACHE_TTL_BASIC = 5 * 60 * 1000; // 每日指标 5分钟
const CACHE_TTL_HOLDER = 30 * 60 * 1000; // 股东 30分钟
const CACHE_TTL_NEWS = 30 * 60 * 1000; // 新闻 30分钟
const CACHE_TTL_QUOTE = 30 * 1000; // 实时行情 30秒

interface TushareResponse {
  request_id: string;
  code: number;
  msg: string;
  data: {
    fields: string[];
    items: (string | number)[][];
  };
}

async function request(apiName: string, params: Record<string, string> = {}, fields: string = ''): Promise<Record<string, unknown>[]> {
  const TOKEN = getToken();
  if (!TOKEN || TOKEN === 'your_token_here') {
    console.warn('TUSHARE_TOKEN not set, returning empty data');
    return [];
  }

  try {
    const resp = await axios.post<TushareResponse>(TUSHARE_API_URL, {
      api_name: apiName,
      token: TOKEN,
      params,
      fields,
    });

    const { code, msg, data } = resp.data;
    if (code !== 0) {
      console.warn(`Tushare API error [${apiName}]: ${msg}`);
      return [];
    }

    if (!data || !data.fields || !data.items) {
      return [];
    }

    return data.items.map((item) => {
      const row: Record<string, unknown> = {};
      data.fields.forEach((field, idx) => {
        row[field] = item[idx];
      });
      return row;
    });
  } catch (err) {
    console.error(`Tushare API request failed [${apiName}]:`, (err as Error).message);
    return [];
  }
}

export interface DailyBar {
  ts_code: string;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  pre_close: number;
  change: number;
  pct_chg: number;
  vol: number;
  amount: number;
}

export async function getDailyBars(tsCode: string, startDate: string, endDate: string): Promise<DailyBar[]> {
  const cacheKey = `daily_${tsCode}_${startDate}_${endDate}`;
  const cached = cache.get<DailyBar[]>(cacheKey);
  if (cached) return cached;

  const rows = await request('daily', { ts_code: tsCode, start_date: startDate, end_date: endDate },
    'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount');

  const result = rows.map((r) => ({
    ts_code: String(r.ts_code || ''),
    trade_date: String(r.trade_date || ''),
    open: Number(r.open) || 0,
    high: Number(r.high) || 0,
    low: Number(r.low) || 0,
    close: Number(r.close) || 0,
    pre_close: Number(r.pre_close) || 0,
    change: Number(r.change) || 0,
    pct_chg: Number(r.pct_chg) || 0,
    vol: Number(r.vol) || 0,
    amount: Number(r.amount) || 0,
  }));

  cache.set(cacheKey, result, CACHE_TTL_DAILY);
  return result;
}

export interface DailyBasic {
  ts_code: string;
  trade_date: string;
  close: number;
  turnover_rate: number;
  pe: number;
  pe_ttm: number;
  pb: number;
  ps: number;
  ps_ttm: number;
  dv_ratio: number;
  total_mv: number;
  circ_mv: number;
}

export async function getDailyBasic(tsCode: string, tradeDate: string): Promise<DailyBasic | null> {
  // 先尝试指定日期
  const result = await getDailyBasicByDate(tsCode, tradeDate);
  if (result) return result;

  // 回退：不指定日期，获取最新一条
  const cacheKey = `basic_latest_${tsCode}`;
  const cached = cache.get<DailyBasic | null>(cacheKey);
  if (cached !== null && cached !== undefined) return cached;

  const rows = await request('daily_basic', { ts_code: tsCode },
    'ts_code,trade_date,close,turnover_rate,pe,pe_ttm,pb,ps,ps_ttm,dv_ratio,total_mv,circ_mv');

  if (rows.length === 0) {
    cache.set(cacheKey, null, CACHE_TTL_BASIC);
    return null;
  }

  // 取最后一条（最新）
  const r = rows[rows.length - 1];
  const latest: DailyBasic = {
    ts_code: String(r.ts_code || ''),
    trade_date: String(r.trade_date || ''),
    close: Number(r.close) || 0,
    turnover_rate: Number(r.turnover_rate) || 0,
    pe: Number(r.pe) || 0,
    pe_ttm: Number(r.pe_ttm) || 0,
    pb: Number(r.pb) || 0,
    ps: Number(r.ps) || 0,
    ps_ttm: Number(r.ps_ttm) || 0,
    dv_ratio: Number(r.dv_ratio) || 0,
    total_mv: Number(r.total_mv) || 0,
    circ_mv: Number(r.circ_mv) || 0,
  };

  cache.set(cacheKey, latest, CACHE_TTL_BASIC);
  return latest;
}

// 批量获取某天所有股票的 daily_basic，减少 API 调用次数
export async function getDailyBasicBatch(tsCodes: string[], tradeDate: string): Promise<Map<string, DailyBasic>> {
  const result = new Map<string, DailyBasic>();

  // 先从缓存取
  const missing: string[] = [];
  for (const code of tsCodes) {
    const cached = cache.get<DailyBasic>(`basic_${code}_${tradeDate}`);
    if (cached) {
      result.set(code, cached);
    } else {
      missing.push(code);
    }
  }

  if (missing.length === 0) return result;

  // 尝试批量查询指定日期
  const rows = await request('daily_basic', { trade_date: tradeDate },
    'ts_code,trade_date,close,turnover_rate,pe,pe_ttm,pb,ps,ps_ttm,dv_ratio,total_mv,circ_mv');

  const found = new Set<string>();
  for (const r of rows) {
    const code = String(r.ts_code || '');
    if (missing.includes(code)) {
      const basic: DailyBasic = {
        ts_code: code,
        trade_date: String(r.trade_date || ''),
        close: Number(r.close) || 0,
        turnover_rate: Number(r.turnover_rate) || 0,
        pe: Number(r.pe) || 0,
        pe_ttm: Number(r.pe_ttm) || 0,
        pb: Number(r.pb) || 0,
        ps: Number(r.ps) || 0,
        ps_ttm: Number(r.ps_ttm) || 0,
        dv_ratio: Number(r.dv_ratio) || 0,
        total_mv: Number(r.total_mv) || 0,
        circ_mv: Number(r.circ_mv) || 0,
      };
      result.set(code, basic);
      cache.set(`basic_${code}_${tradeDate}`, basic, CACHE_TTL_BASIC);
      found.add(code);
    }
  }

  // 对仍然缺失的，查询这些股票最近一次的数据（1次API调用）
  const stillMissing = missing.filter(c => !found.has(c));
  if (stillMissing.length > 0) {
    // 尝试查询最近 5 天的数据，覆盖这些股票
    const recentDate = getDateNDaysAgo(5);
    const fallbackRows = await request('daily_basic', { trade_date: recentDate },
      'ts_code,trade_date,close,turnover_rate,pe,pe_ttm,pb,ps,ps_ttm,dv_ratio,total_mv,circ_mv');

    for (const r of fallbackRows) {
      const code = String(r.ts_code || '');
      if (stillMissing.includes(code) && !result.has(code)) {
        const basic: DailyBasic = {
          ts_code: code,
          trade_date: String(r.trade_date || ''),
          close: Number(r.close) || 0,
          turnover_rate: Number(r.turnover_rate) || 0,
          pe: Number(r.pe) || 0,
          pe_ttm: Number(r.pe_ttm) || 0,
          pb: Number(r.pb) || 0,
          ps: Number(r.ps) || 0,
          ps_ttm: Number(r.ps_ttm) || 0,
          dv_ratio: Number(r.dv_ratio) || 0,
          total_mv: Number(r.total_mv) || 0,
          circ_mv: Number(r.circ_mv) || 0,
        };
        result.set(code, basic);
        cache.set(`basic_${code}_${tradeDate}`, basic, CACHE_TTL_BASIC);
      }
    }
  }

  return result;
}

async function getDailyBasicByDate(tsCode: string, tradeDate: string): Promise<DailyBasic | null> {
  const cacheKey = `basic_${tsCode}_${tradeDate}`;
  const cached = cache.get<DailyBasic | null>(cacheKey);
  if (cached !== null) return cached;

  const rows = await request('daily_basic', { ts_code: tsCode, trade_date: tradeDate },
    'ts_code,trade_date,close,turnover_rate,pe,pe_ttm,pb,ps,ps_ttm,dv_ratio,total_mv,circ_mv');

  if (rows.length === 0) {
    cache.set(cacheKey, null, CACHE_TTL_BASIC);
    return null;
  }

  const r = rows[0];
  const result: DailyBasic = {
    ts_code: String(r.ts_code || ''),
    trade_date: String(r.trade_date || ''),
    close: Number(r.close) || 0,
    turnover_rate: Number(r.turnover_rate) || 0,
    pe: Number(r.pe) || 0,
    pe_ttm: Number(r.pe_ttm) || 0,
    pb: Number(r.pb) || 0,
    ps: Number(r.ps) || 0,
    ps_ttm: Number(r.ps_ttm) || 0,
    dv_ratio: Number(r.dv_ratio) || 0,
    total_mv: Number(r.total_mv) || 0,
    circ_mv: Number(r.circ_mv) || 0,
  };

  cache.set(cacheKey, result, CACHE_TTL_BASIC);
  return result;
}

export interface Top10Holder {
  ts_code: string;
  ann_date: string;
  end_date: string;
  holder_name: string;
  hold_amount: number;
  hold_ratio: number;
}

export async function getTop10Holders(tsCode: string): Promise<Top10Holder[]> {
  const cacheKey = `holder_${tsCode}`;
  const cached = cache.get<Top10Holder[]>(cacheKey);
  if (cached) return cached;

  const rows = await request('top10_holders', { ts_code: tsCode },
    'ts_code,ann_date,end_date,holder_name,hold_amount,hold_ratio');

  const result = rows.map((r) => ({
    ts_code: String(r.ts_code || ''),
    ann_date: String(r.ann_date || ''),
    end_date: String(r.end_date || ''),
    holder_name: String(r.holder_name || ''),
    hold_amount: Number(r.hold_amount) || 0,
    hold_ratio: Number(r.hold_ratio) || 0,
  }));

  cache.set(cacheKey, result, CACHE_TTL_HOLDER);
  return result;
}

export interface NewsItem {
  title: string;
  content: string;
  pub_time: string;
  channels: string;
  src: string;
}

export async function getNews(_tsCode: string): Promise<NewsItem[]> {
  // 无权限访问新闻接口，直接返回空数组
  return [];
}

export interface Announcement {
  ts_code: string;
  ann_date: string;
  ann_time: string;
  ann_type: string;
  title: string;
  content: string;
  url: string;
}

export async function getAnnouncements(_tsCode: string): Promise<Announcement[]> {
  // 无权限访问公告接口，直接返回空数组
  return [];
}

export interface Dividend {
  ts_code: string;
  end_date: string;
  div_proc: string;
  stk_div: number;
  stk_bo_rate: number;
  stk_co_rate: number;
  cash_div: number;
  cash_div_tax: number;
  record_date: string;
  ex_date: string;
  pay_date: string;
  div_listdate: string;
  imp_date: string;
  base_date: string;
  base_share: number;
}

export async function getDividends(tsCode: string): Promise<Dividend[]> {
  const cacheKey = `dividend_${tsCode}`;
  const cached = cache.get<Dividend[]>(cacheKey);
  if (cached) return cached;

  const rows = await request('dividend', { ts_code: tsCode },
    'ts_code,end_date,div_proc,stk_div,stk_bo_rate,stk_co_rate,cash_div,cash_div_tax,record_date,ex_date,pay_date,div_listdate,imp_date,base_date,base_share');

  const result = rows.map((r) => ({
    ts_code: String(r.ts_code || ''),
    end_date: String(r.end_date || ''),
    div_proc: String(r.div_proc || ''),
    stk_div: Number(r.stk_div) || 0,
    stk_bo_rate: Number(r.stk_bo_rate) || 0,
    stk_co_rate: Number(r.stk_co_rate) || 0,
    cash_div: Number(r.cash_div) || 0,
    cash_div_tax: Number(r.cash_div_tax) || 0,
    record_date: String(r.record_date || ''),
    ex_date: String(r.ex_date || ''),
    pay_date: String(r.pay_date || ''),
    div_listdate: String(r.div_listdate || ''),
    imp_date: String(r.imp_date || ''),
    base_date: String(r.base_date || ''),
    base_share: Number(r.base_share) || 0,
  }));

  cache.set(cacheKey, result, CACHE_TTL_NEWS);
  return result;
}

export interface MoneyFlow {
  ts_code: string;
  trade_date: string;
  buy_sm_vol: number;
  buy_sm_amount: number;
  sell_sm_vol: number;
  sell_sm_amount: number;
  buy_md_vol: number;
  buy_md_amount: number;
  sell_md_vol: number;
  sell_md_amount: number;
  buy_lg_vol: number;
  buy_lg_amount: number;
  sell_lg_vol: number;
  sell_lg_amount: number;
  buy_elg_vol: number;
  buy_elg_amount: number;
  sell_elg_vol: number;
  sell_elg_amount: number;
}

const CACHE_TTL_MONEYFLOW = 5 * 60 * 1000;

export async function getMoneyFlow(tsCode: string, tradeDate: string): Promise<MoneyFlow | null> {
  const cacheKey = `moneyflow_${tsCode}_${tradeDate}`;
  const cached = cache.get<MoneyFlow | null>(cacheKey);
  if (cached !== null && cached !== undefined) return cached;

  const rows = await request(
    'moneyflow',
    { ts_code: tsCode, trade_date: tradeDate },
    'ts_code,trade_date,buy_sm_vol,buy_sm_amount,sell_sm_vol,sell_sm_amount,buy_md_vol,buy_md_amount,sell_md_vol,sell_md_amount,buy_lg_vol,buy_lg_amount,sell_lg_vol,sell_lg_amount,buy_elg_vol,buy_elg_amount,sell_elg_vol,sell_elg_amount',
  );

  if (rows.length === 0) {
    cache.set(cacheKey, null, CACHE_TTL_MONEYFLOW);
    return null;
  }

  const r = rows[0];
  const result: MoneyFlow = {
    ts_code: String(r.ts_code || ''),
    trade_date: String(r.trade_date || ''),
    buy_sm_vol: Number(r.buy_sm_vol) || 0,
    buy_sm_amount: Number(r.buy_sm_amount) || 0,
    sell_sm_vol: Number(r.sell_sm_vol) || 0,
    sell_sm_amount: Number(r.sell_sm_amount) || 0,
    buy_md_vol: Number(r.buy_md_vol) || 0,
    buy_md_amount: Number(r.buy_md_amount) || 0,
    sell_md_vol: Number(r.sell_md_vol) || 0,
    sell_md_amount: Number(r.sell_md_amount) || 0,
    buy_lg_vol: Number(r.buy_lg_vol) || 0,
    buy_lg_amount: Number(r.buy_lg_amount) || 0,
    sell_lg_vol: Number(r.sell_lg_vol) || 0,
    sell_lg_amount: Number(r.sell_lg_amount) || 0,
    buy_elg_vol: Number(r.buy_elg_vol) || 0,
    buy_elg_amount: Number(r.buy_elg_amount) || 0,
    sell_elg_vol: Number(r.sell_elg_vol) || 0,
    sell_elg_amount: Number(r.sell_elg_amount) || 0,
  };

  cache.set(cacheKey, result, CACHE_TTL_MONEYFLOW);
  return result;
}

export interface RealtimeQuote {
  ts_code: string;
  name: string;
  price: number;
  pre_close: number;
  change: number;
  pct_chg: number;
  vol: number;
  amount: number;
}

export async function getRealtimeQuotes(tsCodes: string[]): Promise<RealtimeQuote[]> {
  // 使用 daily_basic + daily 获取最新行情数据
  const today = getToday();
  const results: RealtimeQuote[] = [];

  for (const code of tsCodes) {
    const cacheKey = `quote_${code}`;
    const cached = cache.get<RealtimeQuote | null>(cacheKey);
    if (cached) {
      results.push(cached);
      continue;
    }

    const bars = await getDailyBars(code, getDateNDaysAgo(5), today);
    if (bars.length > 0) {
      const latest = bars[bars.length - 1];
      const quote: RealtimeQuote = {
        ts_code: code,
        name: '',
        price: latest.close,
        pre_close: latest.pre_close,
        change: latest.change,
        pct_chg: latest.pct_chg,
        vol: latest.vol,
        amount: latest.amount,
      };
      cache.set(cacheKey, quote, CACHE_TTL_QUOTE);
      results.push(quote);
    }
  }

  return results;
}

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export { getToday, getDateNDaysAgo };
