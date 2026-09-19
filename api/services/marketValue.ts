import axios from 'axios';
import iconv from 'iconv-lite';
import * as cache from './cache.js';
import { getDailyBasicBatch, getRecentTradeDates, getToday, type DailyBasic } from './tushare.js';

export interface MarketValue {
  value: number | null;
  source: 'tushare' | 'tencent' | null;
  as_of: string | null;
  currency: 'CNY' | 'HKD';
  status: 'available' | 'previous_close' | 'stale' | 'conflict' | 'missing';
  checked_at: string;
  comparison?: { source: string; value: number; as_of: string; difference_pct: number };
}

export function parseTencentValues(text: string, requested: string[]): Map<string, MarketValue> {
  const result = new Map<string, MarketValue>();
  for (const match of text.matchAll(/v_((?:sh|sz|bj|hk)\d+)="([^"]+)"/g)) {
    const prefix = match[1].slice(0, 2);
    const code = `${match[1].slice(2)}.${prefix.toUpperCase()}`;
    const fields = match[2].split('~');
    const date = (fields[30] ?? '').replace(/\D/g, '').slice(0, 8);
    const value = Number(fields[45]) * 10000;
    if (!requested.includes(code) || fields[2] !== match[1].slice(2)
      || fields.length < 60 || !/^\d{8}$/.test(date) || date > getToday()
      || !Number.isFinite(value) || value <= 0 || !(Number(fields[3]) > 0)) continue;
    result.set(code, { value, source: 'tencent', as_of: date, currency: prefix === 'hk' ? 'HKD' : 'CNY',
      status: 'available', checked_at: new Date().toISOString() });
  }
  return result;
}

async function tencentValues(codes: string[]): Promise<Map<string, MarketValue>> {
  const key = `market_value_qq_${[...codes].sort().join(',')}`;
  const cached = cache.get<Map<string, MarketValue>>(key);
  if (cached) return cached;
  const result = new Map<string, MarketValue>();
  for (let i = 0; i < codes.length; i += 60) {
    const group = codes.slice(i, i + 60);
    try {
      const symbols = group.map(c => c.split('.')[1].toLowerCase() + c.split('.')[0]);
      const response = await axios.get(`https://qt.gtimg.cn/q=${symbols.join(',')}`, {
        timeout: 6000, responseType: 'arraybuffer', headers: { Referer: 'https://gu.qq.com/' },
      });
      for (const [code, value] of parseTencentValues(iconv.decode(Buffer.from(response.data), 'gbk'), group)) result.set(code, value);
    } catch { /* An unavailable provider cannot supply a value. */ }
  }
  if (result.size) cache.set(key, result, 30000);
  return result;
}

export function selectMarketValue(code: string, basic: DailyBasic | undefined, quote: MarketValue | undefined,
  recentDates: string[], today: string): MarketValue {
  const primary: MarketValue | undefined = basic && basic.total_mv > 0 && Number.isFinite(basic.total_mv)
    ? { value: basic.total_mv, source: 'tushare', as_of: basic.trade_date, currency: 'CNY',
      status: 'available', checked_at: new Date().toISOString() } : undefined;
  const selected = quote && (!primary || quote.as_of! > primary.as_of!) ? quote : primary ?? quote;
  if (!selected) return { value: null, source: null, as_of: null, currency: code.endsWith('.HK') ? 'HKD' : 'CNY',
    status: 'missing', checked_at: new Date().toISOString() };
  const result = { ...selected };
  // SSE calendar applies only to A shares; HK uses a conservative age flag.
  const age = (Date.parse(`${today.slice(0,4)}-${today.slice(4,6)}-${today.slice(6,8)}`)
    - Date.parse(`${result.as_of!.slice(0,4)}-${result.as_of!.slice(4,6)}-${result.as_of!.slice(6,8)}`)) / 86400000;
  const previous = recentDates.find(d => d < today);
  result.status = result.as_of === today ? 'available'
    : ((result.currency === 'CNY' && previous ? result.as_of! >= previous : age <= 4) ? 'previous_close' : 'stale');
  if (primary && quote && primary.as_of === quote.as_of) {
    const difference = Math.abs(primary.value! - quote.value!) / primary.value! * 100;
    result.comparison = { source: 'tencent', value: quote.value!, as_of: quote.as_of!, difference_pct: difference };
    if (difference > 5) { result.status = 'conflict'; result.value = null; }
  }
  return result;
}

export async function getMarketValues(codes: string[], basics?: Map<string, DailyBasic>): Promise<Map<string, MarketValue>> {
  const today = getToday();
  const aCodes = codes.filter(c => !c.endsWith('.HK'));
  const [primary, secondary, dates] = await Promise.all([
    basics ?? getDailyBasicBatch(aCodes, today), tencentValues(codes), getRecentTradeDates(today),
  ]);
  return new Map(codes.map(code => [code, selectMarketValue(code, code.endsWith('.HK') ? undefined : primary.get(code), secondary.get(code), dates, today)]));
}
