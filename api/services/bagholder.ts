/**
 * 冷西西韭菜50指数（Bagholder 50）算法复制 —— 第三信号系统（本地化精简版）
 *
 * 算法来源：https://github.com/toocoldcc/bagholder50 （MIT License，方法版本 2026-08-12）
 *
 * 本实现的适配（经用户确认）：
 * - 股票池限定为 A 股总市值前 1000（中证1000口径），只计算 A 股，不涉及港股；
 * - 名单基于最近一个"收盘数据齐备"交易日（盘中=昨日收盘，盘后=当日）计算；
 * - 原始数据本地化：首次全量拉取后，每日只增量追加新交易日（few 次调用），
 *   Top50 由本地数据毫秒级算出，读名单零 API 成本、不重复计算；
 * - 四因子与合成规则忠实原版：
 *   1. price_chase_20 = (pct_rank(rev_20) + pct_rank(limit_touch_20)) / 2
 *   2. turn_spike = mean(换手率,20日)/mean(换手率,120日)（min_periods 10/60）
 *   3. toplist_cnt_20 = 近 20 日龙虎榜上榜次数
 *   4. elg_net_20 = Σ(特大单买−卖,20日)/Σ(8类分类金额,20日)（min_periods 15）
 *   四因子横截面百分位等权平均，四项缺一不可（fail-closed，不降级）；
 * - 信号只有两态：进入 Top50 = 卖出（避雷），未进入 = 无信号。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import axios from 'axios';
import * as cache from './cache.js';
import { isHK } from './realtime.js';

const TUSHARE_API_URL = 'https://api.tushare.pro';
const RAW_FILE = join(process.cwd(), 'api', 'data', 'bagholder_raw.json');
const RESULT_FILE = join(process.cwd(), 'api', 'data', 'bagholder50.json');

const TOP_N = 50;
const UNIVERSE_SIZE = 1000; // 市值前 1000（中证1000口径）
const MIN_LIST_DAYS = 120; // 上市满 120 自然日
const EPS = 1e-6; // 涨停触及浮点容差
const PAGE = 5000; // Tushare 单页行数（offset 分页防截断）
const RISK_NAME_RE = /ST|退/i;

const LONG_WINDOW = 132; // 换手率长窗保留日数（≥120）
const SHORT_WINDOW = 22; // 其余因子短窗保留日数（≥21）

const CACHE_TTL_RESULT = 10 * 60 * 1000; // 名单内存缓存 10 分钟
const CACHE_TTL_CAL = 60 * 60 * 1000; // 交易日历缓存 1 小时
const CACHE_TTL_READY = 5 * 60 * 1000; // 最新齐备日试探缓存 5 分钟
const CACHE_TTL_BASIC = 12 * 60 * 60 * 1000; // stock_basic 缓存 12 小时

/* ==================== 导出类型 ==================== */

export interface BagholderFactors {
  price_chase_20: number; // 追涨热度百分位 [0,1]
  turn_spike: number; // 换手放大百分位 [0,1]
  toplist_cnt_20: number; // 龙虎榜热度百分位 [0,1]
  elg_net_20: number; // 特大单拥挤百分位 [0,1]
}

export interface BagholderRawFactors {
  rev_20: number | null; // 20 日复权涨幅
  limit_touch_20: number | null; // 近 20 日触及涨停次数
  turn_spike: number | null; // 换手放大倍数
  toplist_cnt_20: number | null; // 近 20 日龙虎榜次数
  elg_net_20: number | null; // 特大单净额 / 分类成交额之和
}

export interface BagholderComponent {
  rank: number; // 1 = 韭菜分最高、最需警惕
  ts_code: string;
  name: string;
  score: number; // 韭菜分 = 四因子百分位等权平均 [0,1]
  factors: BagholderFactors;
  raw: BagholderRawFactors;
}

export interface BagholderResult {
  signal_date: string; // 收盘数据齐备的信号日（YYYYMMDD）
  entry_date: string | null; // 名单开盘进入的下一交易日（未知为 null）
  generated_at: string;
  universe_count: number; // 参与排名的市值前1000股票数
  valid_count: number; // 四因子齐备、参与排名的股票数
  top50: BagholderComponent[]; // 按韭菜分降序
  scores: Record<string, number>; // 池内韭菜分
  ranks: Record<string, number>; // 池内韭菜分排名（1=最危险）
}

export interface BagholderStockStatus {
  available: boolean; // 港股 / 不在市值前1000池 / 数据未齐备时为 false
  market: 'A' | 'HK';
  signal_date: string | null;
  in_list: boolean; // 是否进入韭菜50（=卖出信号）
  rank: number | null; // Top50 内排名
  score: number | null; // 韭菜分
  percentile: number | null; // 池内韭菜分百分位（0-100，越高越拥挤）
  factors: BagholderFactors | null;
  raw: BagholderRawFactors | null;
  signal: 'sell' | 'none'; // 只有两态：卖出 / 无信号
  signal_text: string;
}

/* ==================== 本地原始数据存储 ==================== */

/** 每只股票的因子窗口数组（对齐 RawStore 的日期轴，null = 当日无数据/停牌） */
interface StockWindow {
  name: string;
  turnover: (number | null)[]; // 对齐 long_dates（换手率）
  close: (number | null)[]; // 对齐 short_dates（收盘价）
  high: (number | null)[]; // 最高价
  adj: (number | null)[]; // 复权因子
  up_limit: (number | null)[]; // 涨停价
  elg_net: (number | null)[]; // 特大单净额（万）
  mf_total: (number | null)[]; // 8 类分类成交金额之和（万）
  toplist: (number | null)[]; // 龙虎榜 0/1
}

interface RawStore {
  version: 2;
  updated_through: string; // 最新已入库交易日
  long_dates: string[]; // 换手率窗口交易日（升序）
  short_dates: string[]; // 其余因子窗口交易日（升序）
  current_universe: string[]; // updated_through 当日市值前1000（A 股池）
  stocks: Record<string, StockWindow>;
}

/* ==================== Tushare 请求（全局节流 + 退避重试 + 分页） ==================== */

interface TushareResponse {
  code: number;
  msg: string;
  data?: { fields: string[]; items: (string | number | null)[][] };
}

/**
 * 全局节流器：Tushare 限流约 500 次/分钟，控制在 ~280 次/分钟以内（200ms 间隔）。
 * 全部请求（含分页）串行过闸，避免全量构建触发限流后整段日期拉空。
 */
const MIN_REQ_INTERVAL = 200;
let lastReqAt = 0;
let throttleChain: Promise<void> = Promise.resolve();
function throttle(): Promise<void> {
  const prev = throttleChain;
  let release: () => void;
  const cur = new Promise<void>((r) => {
    release = r;
  });
  throttleChain = prev.then(async () => {
    const wait = lastReqAt + MIN_REQ_INTERVAL - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastReqAt = Date.now();
    release!();
  });
  return cur;
}

/** 单次请求：ok=false 表示网络/限流失败（值得重试）；ok=true 成功（空行=当日真无数据） */
async function tsRequestOnce(
  apiName: string,
  params: Record<string, string | number>,
  fields: string,
): Promise<{ ok: boolean; rows: Record<string, unknown>[] }> {
  const token = process.env.TUSHARE_TOKEN || '';
  if (!token || token === 'your_token_here') return { ok: true, rows: [] };
  try {
    const resp = await axios.post<TushareResponse>(
      TUSHARE_API_URL,
      { api_name: apiName, token, params, fields },
      { timeout: 30_000 },
    );
    const { code, msg, data } = resp.data;
    if (code !== 0) {
      console.warn(`[bagholder50] Tushare error [${apiName}]: ${msg}`);
      return { ok: false, rows: [] };
    }
    if (!data?.fields || !data.items) return { ok: true, rows: [] };
    return {
      ok: true,
      rows: data.items.map((item) => {
        const row: Record<string, unknown> = {};
        data.fields.forEach((f, i) => {
          row[f] = item[i];
        });
        return row;
      }),
    };
  } catch (err) {
    console.error(`[bagholder50] Tushare failed [${apiName}]:`, (err as Error).message);
    return { ok: false, rows: [] };
  }
}

/** 单接口调用：失败（网络/限流）指数退避重试至 5 次；成功即返回（空行不重试） */
async function tsRequest(
  apiName: string,
  params: Record<string, string | number>,
  fields: string,
): Promise<Record<string, unknown>[]> {
  let delay = 1000;
  for (let attempt = 0; attempt < 5; attempt++) {
    await throttle();
    const { ok, rows } = await tsRequestOnce(apiName, params, fields);
    if (ok) return rows;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 20_000);
  }
  return [];
}

/** 按日期拉全表（offset 分页防截断） */
async function tsRequestByDate(
  apiName: string,
  tradeDate: string,
  fields: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let offset = 0;
  for (let page = 0; page < 4; page++) {
    const rows = await tsRequest(apiName, { trade_date: tradeDate, offset }, fields);
    out.push(...rows);
    if (rows.length < PAGE) break;
    offset += rows.length;
  }
  return out;
}

/** 带并发上限的按日循环拉取（实际速率由全局节流器串行控制） */
async function fetchByDates(
  apiName: string,
  dates: string[],
  fields: string,
  concurrency = 2,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, dates.length)) }, async () => {
    while (next < dates.length) {
      const idx = next++;
      const rows = await tsRequestByDate(apiName, dates[idx], fields);
      out.push(...rows);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 校验交易日整表齐备，缺失日期补拉（防限流残留空洞；top_list 等可为空的接口勿用） */
async function fillMissingDates(
  apiName: string,
  dates: string[],
  rows: Record<string, unknown>[],
  fields: string,
): Promise<Record<string, unknown>[]> {
  const have = new Set(rows.map((r) => String(r.trade_date ?? '')));
  const missing = dates.filter((d) => !have.has(d));
  if (missing.length === 0) return rows;
  console.warn(
    `[bagholder50] ${apiName} 缺 ${missing.length} 个交易日（${missing[0]}..${missing[missing.length - 1]}），补拉`,
  );
  const extra = await fetchByDates(apiName, missing, fields);
  return [...rows, ...extra];
}

/* ==================== 基础工具 ==================== */

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** 近约 190 个交易日（升序） */
async function getTradeDates(): Promise<string[]> {
  const cached = cache.get<string[]>('bagholder_trade_dates');
  if (cached) return cached;
  const rows = await tsRequest(
    'trade_cal',
    { start_date: getDateNDaysAgo(300), end_date: getToday() },
    'cal_date,is_open',
  );
  const dates = rows
    .filter((r) => Number(r.is_open) === 1)
    .map((r) => String(r.cal_date))
    .sort();
  cache.set('bagholder_trade_dates', dates, CACHE_TTL_CAL);
  return dates;
}

/** stock_basic（名称/上市日/状态），长缓存 */
async function getStockMeta(): Promise<Map<string, { name: string; listDate: string }>> {
  const cached = cache.get<Map<string, { name: string; listDate: string }>>('bagholder_stock_meta');
  if (cached) return cached;
  const rows = await tsRequest('stock_basic', {}, 'ts_code,name,list_date,list_status');
  const map = new Map<string, { name: string; listDate: string }>();
  for (const r of rows) {
    const code = String(r.ts_code ?? '');
    if (!code || String(r.list_status ?? '') === 'D') continue;
    map.set(code, { name: String(r.name ?? ''), listDate: String(r.list_date ?? '') });
  }
  cache.set('bagholder_stock_meta', map, CACHE_TTL_BASIC);
  return map;
}

/** 自然日差 */
function calendarDaysBetween(a: string, b: string): number {
  const parse = (s: string) =>
    new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`).getTime();
  return Math.floor((parse(a) - parse(b)) / 86400000);
}

/** 数组末 n 位有效值均值（min 个观察才有效） */
function tailMean(arr: (number | null)[], n: number, min: number): number | null {
  const tail = arr.slice(-n);
  let sum = 0;
  let cnt = 0;
  for (const v of tail) {
    if (v !== null && Number.isFinite(v)) {
      sum += v;
      cnt++;
    }
  }
  return cnt >= min ? sum / cnt : null;
}

/** 横截面百分位排名（同值平均名次） */
function percentileRanks(entries: { code: string; value: number }[]): Map<string, number> {
  const valid = entries.filter((e) => Number.isFinite(e.value));
  const sorted = [...valid].sort((a, b) => a.value - b.value || a.code.localeCompare(b.code));
  const n = sorted.length;
  const out = new Map<string, number>();
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1].value === sorted[i].value) j++;
    const avgPct = (i + j + 2) / 2 / n; // 1-based 平均名次 / n
    for (let k = i; k <= j; k++) out.set(sorted[k].code, avgPct);
    i = j + 1;
  }
  return out;
}

/* ==================== 当日市值前1000股票池 ==================== */

/** 当日 A 股总市值前 1000（过滤 ST/退、.BJ、上市不满 120 日、退市） */
async function getUniverseByMv(signalDate: string): Promise<string[]> {
  const [basicRows, meta] = await Promise.all([
    tsRequestByDate('daily_basic', signalDate, 'ts_code,trade_date,total_mv'),
    getStockMeta(),
  ]);
  if (basicRows.length === 0) throw new Error(`daily_basic(${signalDate}) 整表未到`);

  const entries: { code: string; mv: number }[] = [];
  for (const r of basicRows) {
    const code = String(r.ts_code ?? '');
    const mv = Number(r.total_mv);
    if (!code || !Number.isFinite(mv) || code.endsWith('.BJ')) continue;
    const m = meta.get(code);
    if (!m || RISK_NAME_RE.test(m.name)) continue;
    if (m.listDate && calendarDaysBetween(signalDate, m.listDate) < MIN_LIST_DAYS) continue;
    entries.push({ code, mv });
  }
  entries.sort((a, b) => b.mv - a.mv);
  return entries.slice(0, UNIVERSE_SIZE).map((e) => e.code);
}

/* ==================== RawStore：全量构建 / 增量更新 ==================== */

/** 全表行 → date->code->value */
function rowsToFieldMap(rows: Record<string, unknown>[], field: string): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const date = String(r.trade_date ?? '');
    const code = String(r.ts_code ?? '');
    const v = Number(r[field]);
    if (!date || !code || !Number.isFinite(v)) continue;
    let inner = map.get(date);
    if (!inner) {
      inner = new Map();
      map.set(date, inner);
    }
    inner.set(code, v);
  }
  return map;
}

function mapGet(map: Map<string, Map<string, number>>, date: string, code: string): number | null {
  const v = map.get(date)?.get(code);
  return v !== undefined && Number.isFinite(v) ? v : null;
}

/** 首次全量构建（一次性 ~220 次 API，之后每日增量） */
async function fullBuildRawStore(signalDate: string, tradeDates: string[]): Promise<RawStore> {
  const t0 = Date.now();
  const tIdx = tradeDates.lastIndexOf(signalDate);
  if (tIdx < 0) throw new Error('signal_date 不在交易日历内');

  const universe = await getUniverseByMv(signalDate);
  const uniSet = new Set(universe);

  const dailyDates = tradeDates.slice(Math.max(0, tIdx - (SHORT_WINDOW - 1)), tIdx + 1); // 22 日
  const basicDates = tradeDates.slice(Math.max(0, tIdx - (LONG_WINDOW - 1)), tIdx + 1); // 132 日
  const shortDates = tradeDates.slice(Math.max(0, tIdx - 19), tIdx + 1); // 20 日（资金流/涨停/龙虎榜）

  console.log(
    `[bagholder50] 首次全量构建：signal=${signalDate}，池=${universe.length}，daily ${dailyDates.length}日 / basic ${basicDates.length}日 / short ${shortDates.length}日`,
  );

  const MF_FIELDS = [
    'buy_sm_amount', 'sell_sm_amount', 'buy_md_amount', 'sell_md_amount',
    'buy_lg_amount', 'sell_lg_amount', 'buy_elg_amount', 'sell_elg_amount',
  ];
  const [dailyRows0, adjRows0, basicRows0, limitRows0, topListRows, mfRows0] = await Promise.all([
    fetchByDates('daily', dailyDates, 'ts_code,trade_date,close,high'),
    fetchByDates('adj_factor', dailyDates, 'ts_code,trade_date,adj_factor'),
    fetchByDates('daily_basic', basicDates, 'ts_code,trade_date,turnover_rate'),
    fetchByDates('stk_limit', shortDates, 'ts_code,trade_date,up_limit'),
    fetchByDates('top_list', shortDates, 'ts_code,trade_date'),
    fetchByDates('moneyflow', shortDates, `ts_code,trade_date,${MF_FIELDS.join(',')}`),
  ]);
  // 交易日整表必须齐备：缺失日期补拉（限流/网络残缺防护）
  const [dailyRows, adjRows, basicRows, limitRows, mfRows] = await Promise.all([
    fillMissingDates('daily', dailyDates, dailyRows0, 'ts_code,trade_date,close,high'),
    fillMissingDates('adj_factor', dailyDates, adjRows0, 'ts_code,trade_date,adj_factor'),
    fillMissingDates('daily_basic', basicDates, basicRows0, 'ts_code,trade_date,turnover_rate'),
    fillMissingDates('stk_limit', shortDates, limitRows0, 'ts_code,trade_date,up_limit'),
    fillMissingDates('moneyflow', shortDates, mfRows0, `ts_code,trade_date,${MF_FIELDS.join(',')}`),
  ]);

  // fail-closed 校验：四因子数据源整表必须齐备（补拉后仍缺则失败，不存残缺数据）
  const datesCovered = (rows: Record<string, unknown>[]) => new Set(rows.map((r) => String(r.trade_date ?? '')));
  const missingOf = (dates: string[], covered: Set<string>) => dates.filter((d) => !covered.has(d));
  const dailyMiss = missingOf(dailyDates, datesCovered(dailyRows));
  const adjMiss = missingOf(dailyDates, datesCovered(adjRows));
  const basicMiss = missingOf(basicDates, datesCovered(basicRows));
  const mfMiss = missingOf(shortDates, datesCovered(mfRows));
  if (dailyMiss.length > 0) throw new Error(`daily 缺 ${dailyMiss.length} 个交易日（${dailyMiss[0]}..${dailyMiss[dailyMiss.length - 1]}），fail-closed`);
  if (adjMiss.length > 0) throw new Error(`adj_factor 缺 ${adjMiss.length} 个交易日，fail-closed`);
  if (basicMiss.length > 0) throw new Error(`daily_basic 缺 ${basicMiss.length} 个交易日（${basicMiss[0]}..${basicMiss[basicMiss.length - 1]}），fail-closed`);
  if (mfMiss.length > 0) throw new Error(`moneyflow 缺 ${mfMiss.length} 个交易日，fail-closed`);
  if (limitRows.length === 0) throw new Error('stk_limit 整表未到，fail-closed');
  // top_list 允许为空（当日无上榜按 0 处理）

  const closeMap = rowsToFieldMap(dailyRows, 'close');
  const highMap = rowsToFieldMap(dailyRows, 'high');
  const adjMap = rowsToFieldMap(adjRows, 'adj_factor');
  const turnMap = rowsToFieldMap(basicRows, 'turnover_rate');
  const upLimitMap = rowsToFieldMap(limitRows, 'up_limit');

  // 资金流聚合
  const elgNetMap = new Map<string, Map<string, number>>();
  const mfTotalMap = new Map<string, Map<string, number>>();
  for (const r of mfRows) {
    const date = String(r.trade_date ?? '');
    const code = String(r.ts_code ?? '');
    if (!date || !code || !uniSet.has(code)) continue;
    let total = 0;
    let hasAny = false;
    for (const f of MF_FIELDS) {
      const v = Number(r[f]);
      if (Number.isFinite(v)) {
        total += v;
        hasAny = true;
      }
    }
    if (!hasAny) continue;
    let inner = elgNetMap.get(date);
    if (!inner) {
      inner = new Map();
      elgNetMap.set(date, inner);
    }
    inner.set(code, Number(r.buy_elg_amount) - Number(r.sell_elg_amount));
    let inner2 = mfTotalMap.get(date);
    if (!inner2) {
      inner2 = new Map();
      mfTotalMap.set(date, inner2);
    }
    inner2.set(code, total);
  }

  // 龙虎榜 0/1（date -> code -> 1）
  const toplistMap = new Map<string, Set<string>>();
  for (const r of topListRows) {
    const date = String(r.trade_date ?? '');
    const code = String(r.ts_code ?? '');
    if (!date || !code) continue;
    let set = toplistMap.get(date);
    if (!set) {
      set = new Set();
      toplistMap.set(date, set);
    }
    set.add(code);
  }

  const meta = await getStockMeta();
  const stocks: Record<string, StockWindow> = {};
  for (const code of universe) {
    stocks[code] = {
      name: meta.get(code)?.name ?? code,
      turnover: basicDates.map((d) => mapGet(turnMap, d, code)),
      close: dailyDates.map((d) => mapGet(closeMap, d, code)),
      high: dailyDates.map((d) => mapGet(highMap, d, code)),
      adj: dailyDates.map((d) => mapGet(adjMap, d, code)),
      up_limit: shortDates.map((d) => mapGet(upLimitMap, d, code)),
      elg_net: shortDates.map((d) => mapGet(elgNetMap, d, code)),
      mf_total: shortDates.map((d) => mapGet(mfTotalMap, d, code)),
      toplist: shortDates.map((d) => (toplistMap.get(d)?.has(code) ? 1 : 0)),
    };
  }

  const raw: RawStore = {
    version: 2,
    updated_through: signalDate,
    long_dates: basicDates,
    short_dates: dailyDates,
    current_universe: universe,
    stocks,
  };
  console.log(
    `[bagholder50] 全量构建完成：${Object.keys(stocks).length} 只，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  return raw;
}

/** 单股补拉窗口数据（新入池股票用） */
async function fetchStockWindow(
  code: string,
  name: string,
  longDates: string[],
  shortDates: string[],
): Promise<StockWindow> {
  const MF_FIELDS = [
    'buy_sm_amount', 'sell_sm_amount', 'buy_md_amount', 'sell_md_amount',
    'buy_lg_amount', 'sell_lg_amount', 'buy_elg_amount', 'sell_elg_amount',
  ];
  const range = (dates: string[]) => ({ start_date: dates[0], end_date: dates[dates.length - 1] });
  const [dailyRows, adjRows, basicRows, limitRows, topRows, mfRows] = await Promise.all([
    tsRequest('daily', { ts_code: code, ...range(shortDates) }, 'ts_code,trade_date,close,high'),
    tsRequest('adj_factor', { ts_code: code, ...range(shortDates) }, 'ts_code,trade_date,adj_factor'),
    tsRequest('daily_basic', { ts_code: code, ...range(longDates) }, 'ts_code,trade_date,turnover_rate'),
    tsRequest('stk_limit', { ts_code: code, ...range(shortDates) }, 'ts_code,trade_date,up_limit'),
    tsRequest('top_list', { ts_code: code, ...range(shortDates) }, 'ts_code,trade_date'),
    tsRequest('moneyflow', { ts_code: code, ...range(shortDates) }, `ts_code,trade_date,${MF_FIELDS.join(',')}`),
  ]);

  const toMap = (rows: Record<string, unknown>[], field: string) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const v = Number(r[field]);
      if (Number.isFinite(v)) m.set(String(r.trade_date ?? ''), v);
    }
    return m;
  };
  const closeM = toMap(dailyRows, 'close');
  const highM = toMap(dailyRows, 'high');
  const adjM = toMap(adjRows, 'adj_factor');
  const turnM = toMap(basicRows, 'turnover_rate');
  const limitM = toMap(limitRows, 'up_limit');
  const topDates = new Set(topRows.map((r) => String(r.trade_date ?? '')));
  const elgM = new Map<string, number>();
  const totalM = new Map<string, number>();
  for (const r of mfRows) {
    let total = 0;
    let hasAny = false;
    for (const f of MF_FIELDS) {
      const v = Number(r[f]);
      if (Number.isFinite(v)) {
        total += v;
        hasAny = true;
      }
    }
    if (hasAny) {
      const d = String(r.trade_date ?? '');
      elgM.set(d, Number(r.buy_elg_amount) - Number(r.sell_elg_amount));
      totalM.set(d, total);
    }
  }
  const num = (m: Map<string, number>, d: string) => {
    const v = m.get(d);
    return v !== undefined && Number.isFinite(v) ? v : null;
  };
  return {
    name,
    turnover: longDates.map((d) => num(turnM, d)),
    close: shortDates.map((d) => num(closeM, d)),
    high: shortDates.map((d) => num(highM, d)),
    adj: shortDates.map((d) => num(adjM, d)),
    up_limit: shortDates.map((d) => num(limitM, d)),
    elg_net: shortDates.map((d) => num(elgM, d)),
    mf_total: shortDates.map((d) => num(totalM, d)),
    toplist: shortDates.map((d) => (topDates.has(d) ? 1 : 0)),
  };
}

/**
 * 增量更新：追加新交易日（signalDate）数据 + 池成员同步 + 裁剪窗口。
 * 每日仅 ~10 次 API + 新入池股票补拉。
 */
async function incrementRawStore(raw: RawStore, signalDate: string, _tradeDates: string[]): Promise<RawStore> {
  const t0 = Date.now();
  const MF_FIELDS = [
    'buy_sm_amount', 'sell_sm_amount', 'buy_md_amount', 'sell_md_amount',
    'buy_lg_amount', 'sell_lg_amount', 'buy_elg_amount', 'sell_elg_amount',
  ];

  const universe = await getUniverseByMv(signalDate);
  const [dailyRows, adjRows, basicRows, limitRows, topListRows, mfRows] = await Promise.all([
    tsRequestByDate('daily', signalDate, 'ts_code,trade_date,close,high'),
    tsRequestByDate('adj_factor', signalDate, 'ts_code,trade_date,adj_factor'),
    tsRequestByDate('daily_basic', signalDate, 'ts_code,trade_date,turnover_rate'),
    tsRequestByDate('stk_limit', signalDate, 'ts_code,trade_date,up_limit'),
    tsRequestByDate('top_list', signalDate, 'ts_code,trade_date'),
    tsRequestByDate('moneyflow', signalDate, `ts_code,trade_date,${MF_FIELDS.join(',')}`),
  ]);
  if (dailyRows.length === 0 || mfRows.length === 0 || basicRows.length === 0) {
    throw new Error(`增量数据未齐备（${signalDate}），fail-closed`);
  }

  const toCodeMap = (rows: Record<string, unknown>[], field: string) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const v = Number(r[field]);
      if (Number.isFinite(v)) m.set(String(r.ts_code ?? ''), v);
    }
    return m;
  };
  const closeM = toCodeMap(dailyRows, 'close');
  const highM = toCodeMap(dailyRows, 'high');
  const adjM = toCodeMap(adjRows, 'adj_factor');
  const turnM = toCodeMap(basicRows, 'turnover_rate');
  const limitM = toCodeMap(limitRows, 'up_limit');
  const topSet = new Set(topListRows.map((r) => String(r.ts_code ?? '')));
  const elgM = new Map<string, number>();
  const totalM = new Map<string, number>();
  for (const r of mfRows) {
    let total = 0;
    let hasAny = false;
    for (const f of MF_FIELDS) {
      const v = Number(r[f]);
      if (Number.isFinite(v)) {
        total += v;
        hasAny = true;
      }
    }
    if (hasAny) {
      const code = String(r.ts_code ?? '');
      elgM.set(code, Number(r.buy_elg_amount) - Number(r.sell_elg_amount));
      totalM.set(code, total);
    }
  }
  const num = (m: Map<string, number>, code: string) => {
    const v = m.get(code);
    return v !== undefined && Number.isFinite(v) ? v : null;
  };

  const meta = await getStockMeta();

  // 新入池且无历史数据的股票 → 补拉窗口
  const newCodes = universe.filter((c) => !raw.stocks[c]);
  if (newCodes.length > 0) {
    console.log(`[bagholder50] 新入池 ${newCodes.length} 只，补拉窗口数据`);
    const newShortDates = [...raw.short_dates.slice(-(SHORT_WINDOW - 1)), signalDate];
    const newLongDates = [...raw.long_dates.slice(-(LONG_WINDOW - 1)), signalDate];
    for (const code of newCodes) {
      try {
        raw.stocks[code] = await fetchStockWindow(
          code,
          meta.get(code)?.name ?? code,
          newLongDates,
          newShortDates,
        );
      } catch {
        // 补拉失败 → 留空数据（当日无效，fail-closed 不参与排名）
      }
    }
  }

  // 追加 signalDate 当日数据到全部池内股票
  for (const code of Object.keys(raw.stocks)) {
    const sw = raw.stocks[code];
    sw.turnover.push(num(turnM, code));
    sw.close.push(num(closeM, code));
    sw.high.push(num(highM, code));
    sw.adj.push(num(adjM, code));
    sw.up_limit.push(num(limitM, code));
    sw.elg_net.push(num(elgM, code));
    sw.mf_total.push(num(totalM, code));
    sw.toplist.push(topSet.has(code) ? 1 : 0);
  }

  raw.long_dates.push(signalDate);
  raw.short_dates.push(signalDate);
  raw.current_universe = universe;
  raw.updated_through = signalDate;

  // 裁剪窗口
  if (raw.long_dates.length > LONG_WINDOW) {
    const cut = raw.long_dates.length - LONG_WINDOW;
    raw.long_dates = raw.long_dates.slice(cut);
    for (const code of Object.keys(raw.stocks)) raw.stocks[code].turnover = raw.stocks[code].turnover.slice(cut);
  }
  if (raw.short_dates.length > SHORT_WINDOW) {
    const cut = raw.short_dates.length - SHORT_WINDOW;
    raw.short_dates = raw.short_dates.slice(cut);
    for (const code of Object.keys(raw.stocks)) {
      const sw = raw.stocks[code];
      sw.close = sw.close.slice(cut);
      sw.high = sw.high.slice(cut);
      sw.adj = sw.adj.slice(cut);
      sw.up_limit = sw.up_limit.slice(cut);
      sw.elg_net = sw.elg_net.slice(cut);
      sw.mf_total = sw.mf_total.slice(cut);
      sw.toplist = sw.toplist.slice(cut);
    }
  }

  console.log(
    `[bagholder50] 增量完成：${signalDate}，池=${universe.length}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  return raw;
}

async function saveRawStore(raw: RawStore): Promise<void> {
  try {
    await mkdir(join(process.cwd(), 'api', 'data'), { recursive: true });
    await writeFile(RAW_FILE, JSON.stringify(raw), 'utf-8');
  } catch (err) {
    console.error('[bagholder50] 写 raw 缓存失败:', (err as Error).message);
  }
}

/* ==================== 因子计算与 Top50（纯本地） ==================== */

function computeTop50(raw: RawStore, tradeDates: string[]): BagholderResult {
  interface RawRow {
    code: string;
    rev_20: number | null;
    limit_touch_20: number | null;
    turn_spike: number | null;
    toplist_cnt_20: number | null;
    elg_net_20: number | null;
  }
  const raws: RawRow[] = [];

  for (const code of raw.current_universe) {
    const sw = raw.stocks[code];
    if (!sw) continue; // 池内但无数据 → 当日无效（fail-closed）

    // rev_20：复权收盘（adj 缺日向前填充），short 窗口末 21 位
    let lastAdj: number | null = null;
    const closeAdj: number[] = sw.close.map((c, i) => {
      if (sw.adj[i] !== null) lastAdj = sw.adj[i];
      return c !== null && lastAdj !== null ? c * lastAdj : NaN;
    });
    let rev20: number | null = null;
    if (closeAdj.length >= 21) {
      const cur = closeAdj[closeAdj.length - 1];
      const prev = closeAdj[closeAdj.length - 21];
      if (Number.isFinite(cur) && Number.isFinite(prev) && prev > 0) rev20 = cur / prev - 1;
    }

    // limit_touch_20：末 20 日最高价触及涨停（停牌/缺价按 0）
    let touchCnt = 0;
    const tail = 20;
    for (let i = sw.high.length - tail; i < sw.high.length; i++) {
      const hi = sw.high[i];
      const up = sw.up_limit[i];
      const cl = sw.close[i];
      if (hi !== null && up !== null && cl !== null && hi >= up - EPS) touchCnt++;
    }

    // turn_spike：20 日均值 / 120 日均值（min_periods 10/60）
    const t20 = tailMean(sw.turnover, 20, 10);
    const t120 = tailMean(sw.turnover, 120, 60);
    const turnSpike = t20 !== null && t120 !== null && t120 > 0 ? t20 / t120 : null;

    // toplist_cnt_20：末 20 日上榜次数
    let toplistCnt = 0;
    for (let i = sw.toplist.length - 20; i < sw.toplist.length; i++) {
      if (sw.toplist[i] === 1) toplistCnt++;
    }

    // elg_net_20：Σ特大单净额 / Σ分类金额（窗口有效天数 ≥ 15）
    let elgSum = 0;
    let totalSum = 0;
    let mfDays = 0;
    for (let i = sw.elg_net.length - 20; i < sw.elg_net.length; i++) {
      const net = sw.elg_net[i];
      const tot = sw.mf_total[i];
      if (net !== null && tot !== null) {
        elgSum += net;
        totalSum += tot;
        mfDays++;
      }
    }
    const elgNet = mfDays >= 15 && totalSum > 0 ? elgSum / totalSum : null;

    raws.push({ code, rev_20: rev20, limit_touch_20: touchCnt, turn_spike: turnSpike, toplist_cnt_20: toplistCnt, elg_net_20: elgNet });
  }

  // 横截面百分位（只在有效值上排名）
  const rankOf = (key: keyof RawRow) =>
    percentileRanks(raws.filter((r) => r[key] !== null).map((r) => ({ code: r.code, value: r[key] as number })));
  const revRank = rankOf('rev_20');
  const limitRank = rankOf('limit_touch_20');
  const turnRank = rankOf('turn_spike');
  const toplistRank = rankOf('toplist_cnt_20');
  const elgRank = rankOf('elg_net_20');

  interface ScoreRow {
    code: string;
    score: number;
    factors: BagholderFactors;
  }
  const scored: ScoreRow[] = [];
  for (const r of raws) {
    const pRev = revRank.get(r.code);
    const pLimit = limitRank.get(r.code);
    const pTurn = turnRank.get(r.code);
    const pTop = toplistRank.get(r.code);
    const pElg = elgRank.get(r.code);
    // 四项缺一不可：price_chase 需要 rev 与 limit 两个分位都有效
    if (pRev === undefined || pLimit === undefined || pTurn === undefined || pTop === undefined || pElg === undefined) {
      continue;
    }
    const priceChase = (pRev + pLimit) / 2;
    scored.push({
      code: r.code,
      score: +(priceChase / 4 + pTurn / 4 + pTop / 4 + pElg / 4).toFixed(4),
      factors: {
        price_chase_20: +priceChase.toFixed(4),
        turn_spike: +pTurn.toFixed(4),
        toplist_cnt_20: +pTop.toFixed(4),
        elg_net_20: +pElg.toFixed(4),
      },
    });
  }

  // Top50（分数降序，同分按代码升序 = pandas nlargest keep='first'）
  scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  if (scored.length < TOP_N) {
    throw new Error(`四因子齐备股票仅 ${scored.length} 只（<${TOP_N}），严格 Top50 失败，不补位（fail-closed）`);
  }

  const rawByCode = new Map(raws.map((r) => [r.code, r]));
  const top50: BagholderComponent[] = scored.slice(0, TOP_N).map((s, i) => {
    const rr = rawByCode.get(s.code)!;
    return {
      rank: i + 1,
      ts_code: s.code,
      name: raw.stocks[s.code]?.name ?? s.code,
      score: s.score,
      factors: s.factors,
      raw: {
        rev_20: rr.rev_20,
        limit_touch_20: rr.limit_touch_20,
        turn_spike: rr.turn_spike,
        toplist_cnt_20: rr.toplist_cnt_20,
        elg_net_20: rr.elg_net_20,
      },
    };
  });

  const scores: Record<string, number> = {};
  const ranks: Record<string, number> = {};
  scored.forEach((s, i) => {
    scores[s.code] = s.score;
    ranks[s.code] = i + 1;
  });

  const tIdx = tradeDates.lastIndexOf(raw.updated_through);
  const entryDate = tIdx >= 0 && tIdx + 1 < tradeDates.length ? tradeDates[tIdx + 1] : null;

  return {
    signal_date: raw.updated_through,
    entry_date: entryDate,
    generated_at: new Date().toISOString(),
    universe_count: raw.current_universe.length,
    valid_count: scored.length,
    top50,
    scores,
    ranks,
  };
}

/* ==================== 对外入口 ==================== */

let inflight: Promise<BagholderResult> | null = null;

/** 确定最近"收盘数据齐备"的交易日（daily+moneyflow 整表到齐） */
async function determineReadyDate(tradeDates: string[]): Promise<string> {
  const cacheKey = 'bagholder_ready_date';
  const cached = cache.get<string>(cacheKey);
  if (cached) return cached;
  for (let i = tradeDates.length - 1; i >= Math.max(0, tradeDates.length - 4); i--) {
    const d = tradeDates[i];
    const [dailyRows, mfRows] = await Promise.all([
      tsRequest('daily', { trade_date: d }, 'ts_code'),
      tsRequest('moneyflow', { trade_date: d }, 'ts_code'),
    ]);
    if (dailyRows.length > 0 && mfRows.length > 0) {
      cache.set(cacheKey, d, CACHE_TTL_READY);
      return d;
    }
  }
  throw new Error('近期交易日收盘数据均未齐备（fail-closed）');
}

async function loadRawStore(): Promise<RawStore | null> {
  try {
    const raw = await readFile(RAW_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as RawStore;
    if (parsed?.version === 2 && parsed.updated_through && parsed.stocks) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * 获取最新韭菜50名单：
 * 名单内存缓存（10 分钟）→ raw 本地数据 → 落后则增量更新 → 本地毫秒级计算 Top50。
 * 盘中名单 = 昨日收盘（今日开盘生效）；盘后数据齐备自动切换为当日收盘名单。
 */
export async function getBagholder50(): Promise<BagholderResult> {
  const cached = cache.get<BagholderResult>('bagholder50_result');
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const tradeDates = await getTradeDates();
      const readyDate = await determineReadyDate(tradeDates);

      let raw = await loadRawStore();
      if (!raw) {
        raw = await fullBuildRawStore(readyDate, tradeDates);
        await saveRawStore(raw);
      } else if (raw.updated_through < readyDate) {
        // 逐日增量（一般每天只差 1 日；缺口多日也逐日补齐）
        let cursor = raw;
        const fromIdx = tradeDates.lastIndexOf(cursor.updated_through);
        for (let i = fromIdx + 1; i < tradeDates.length; i++) {
          const d = tradeDates[i];
          if (d > readyDate) break;
          cursor = await incrementRawStore(cursor, d, tradeDates);
        }
        await saveRawStore(cursor);
        raw = cursor;
      }

      const result = computeTop50(raw, tradeDates);
      cache.set('bagholder50_result', result, CACHE_TTL_RESULT);
      try {
        await writeFile(RESULT_FILE, JSON.stringify(result), 'utf-8');
      } catch {
        // 结果写盘失败不影响返回
      }
      return result;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** 单股韭菜50状态：上榜=卖出信号，未上榜=无信号（两态）；港股/池外股无信号 */
export async function getBagholderStatus(tsCode: string): Promise<BagholderStockStatus> {
  if (isHK(tsCode)) {
    return {
      available: false,
      market: 'HK',
      signal_date: null,
      in_list: false,
      rank: null,
      score: null,
      percentile: null,
      factors: null,
      raw: null,
      signal: 'none',
      signal_text: '韭菜50仅覆盖A股市值前1000（中证1000口径），港股不参与计算，无信号',
    };
  }

  let result: BagholderResult | null = null;
  try {
    result = await getBagholder50();
  } catch (err) {
    console.error('[bagholder50] 名单获取失败:', (err as Error).message);
    return {
      available: false,
      market: 'A',
      signal_date: null,
      in_list: false,
      rank: null,
      score: null,
      percentile: null,
      factors: null,
      raw: null,
      signal: 'none',
      signal_text: `韭菜50名单生成失败（${(err as Error).message}），数据未齐备时不降级（fail-closed），本次无信号`,
    };
  }

  const comp = result.top50.find((c) => c.ts_code === tsCode);
  if (comp) {
    return {
      available: true,
      market: 'A',
      signal_date: result.signal_date,
      in_list: true,
      rank: comp.rank,
      score: comp.score,
      percentile: +(((result.ranks[tsCode] ?? 0) / result.valid_count) * 100).toFixed(1),
      factors: comp.factors,
      raw: comp.raw,
      signal: 'sell',
      signal_text: `韭菜分 ${comp.score.toFixed(3)}（第 ${comp.rank}/50 名）入选韭菜50（${result.signal_date} 收盘）：追涨热度、换手放大、龙虎榜注意力、特大单流量四因子拥挤共振，为市值前1000中最易跑输的尾部，建议卖出避雷`,
    };
  }

  const score = result.scores[tsCode];
  if (score !== undefined) {
    const rank = result.ranks[tsCode] ?? 0;
    return {
      available: true,
      market: 'A',
      signal_date: result.signal_date,
      in_list: false,
      rank: null,
      score,
      percentile: +((rank / result.valid_count) * 100).toFixed(1),
      factors: null,
      raw: null,
      signal: 'none',
      signal_text: `未进入韭菜50名单：韭菜分 ${score.toFixed(3)}，市值前1000池内第 ${rank}/${result.valid_count} 位（百分位 ${((rank / result.valid_count) * 100).toFixed(1)}%），拥挤度未触避雷线，无信号`,
    };
  }

  return {
    available: false,
    market: 'A',
    signal_date: result.signal_date,
    in_list: false,
    rank: null,
    score: null,
    percentile: null,
    factors: null,
    raw: null,
    signal: 'none',
    signal_text: '该股不在市值前1000监控池内（或为次新股/停牌无四因子数据），韭菜50无信号',
  };
}

/** 服务器启动预热（失败不阻塞） */
export function warmupBagholder50(): void {
  getBagholder50().catch((err) => {
    console.error('[bagholder50] 预热失败:', (err as Error).message);
  });
}
