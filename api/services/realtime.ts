/**
 * 新浪财经实时行情服务。
 *
 * 数据格式:GBK 编码文本,逗号分隔字段。
 * API: https://hq.sinajs.cn/list=sh600000,sz000001
 */
import axios from 'axios';
import iconv from 'iconv-lite';

import * as cache from './cache.js';

// 实时行情缓存 30 秒
const CACHE_TTL_REALTIME = 30 * 1000;

export interface RealtimeQuote {
  ts_code: string;
  name: string;
  price: number;
  pre_close: number;
  open: number;
  high: number;
  low: number;
  change: number;
  pct_chg: number;
  vol: number;
  amount: number;
}

/**
 * 将 Tushare 代码转换为新浪代码。
 * 688256.SH -> sh688256
 * 300308.SZ -> sz300308
 * 02096.HK -> hk02096（港股代码补0到5位）
 */
function toSinaCode(tsCode: string): string {
  const [code, market] = tsCode.split('.');
  if (market === 'HK') {
    // 港股代码补0到5位，02096 -> hk02096，0941 -> hk00941
    return `hk${code.padStart(5, '0')}`;
  }
  return market === 'SH' ? `sh${code}` : `sz${code}`;
}

/**
 * 判断是否为港股代码。
 */
export function isHK(tsCode: string): boolean {
  return tsCode.endsWith('.HK');
}

/**
 * 从新浪财经获取实时行情(批量)。
 * 失败时返回空数组,上游会回退到 Tushare。
 */
export async function getSinaRealtimeQuotes(tsCodes: string[]): Promise<RealtimeQuote[]> {
  if (tsCodes.length === 0) return [];

  const cacheKey = `sina_realtime_${tsCodes.slice().sort().join('_')}`;
  const cached = cache.get<RealtimeQuote[]>(cacheKey);
  if (cached) return cached;

  const sinaCodes = tsCodes.map(toSinaCode);
  const url = `https://hq.sinajs.cn/list=${sinaCodes.join(',')}`;

  try {
    const resp = await axios.get(url, {
      headers: {
        Referer: 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      timeout: 5000,
      responseType: 'arraybuffer',
    });

    // 新浪返回 GBK 编码,转 UTF-8
    const text = iconv.decode(Buffer.from(resp.data), 'gbk');

    const results: RealtimeQuote[] = [];
    const lines = text.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.includes('=')) continue;

      const match = line.match(/hq_str_(\w+)="(.+)"/);
      if (!match) continue;

      const sinaCode = match[1];
      const data = match[2].split(',');

      let tsCode: string;
      let name: string;
      let open: number;
      let preClose: number;
      let price: number;
      let high: number;
      let low: number;
      let vol: number;
      let amount: number;
      let pctChg: number;

      if (sinaCode.startsWith('hk')) {
        // 港股格式:英文名,中文名,今开,昨收,最高,最低,现价,涨跌额,涨跌幅%,买一,卖一,成交量(股),成交额(千)...
        if (data.length < 13) continue;
        name = data[1];
        open = parseFloat(data[2]) || 0;
        preClose = parseFloat(data[3]) || 0;
        high = parseFloat(data[4]) || 0;
        low = parseFloat(data[5]) || 0;
        price = parseFloat(data[6]) || 0;
        const change = parseFloat(data[7]) || 0;
        pctChg = parseFloat(data[8]) || (preClose > 0 ? (change / preClose) * 100 : 0);
        vol = parseFloat(data[11]) || 0; // 成交量(股)
        amount = parseFloat(data[12]) * 1000 || 0; // 成交额(千→元)
        // 港股代码还原：hk02096 -> 02096.HK，保持5位补0格式与Tushare一致
        tsCode = `${sinaCode.slice(2)}.HK`;
      } else {
        // A股格式:名称,今开,昨收,当前价,最高,最低,买一,卖一,成交量,成交额,...
        if (data.length < 10) continue;
        name = data[0];
        open = parseFloat(data[1]) || 0;
        preClose = parseFloat(data[2]) || 0;
        price = parseFloat(data[3]) || 0;
        high = parseFloat(data[4]) || 0;
        low = parseFloat(data[5]) || 0;
        vol = parseFloat(data[8]) || 0; // 成交量(股)
        amount = parseFloat(data[9]) || 0; // 成交额(元)
        const change = price - preClose;
        pctChg = preClose > 0 ? (change / preClose) * 100 : 0;
        // A股代码还原
        tsCode = sinaCode.startsWith('sh')
          ? `${sinaCode.slice(2).toUpperCase()}.SH`
          : `${sinaCode.slice(2).toUpperCase()}.SZ`;
      }

      const change = price - preClose;

      results.push({
        ts_code: tsCode,
        name,
        price,
        pre_close: preClose,
        open,
        high,
        low,
        change,
        pct_chg: +pctChg.toFixed(2),
        vol: vol / 100, // 转换为手
        amount: amount / 10000, // 转换为万元
      });
    }

    cache.set(cacheKey, results, CACHE_TTL_REALTIME);
    return results;
  } catch (err) {
    console.error('新浪财经实时行情失败:', (err as Error).message);
    return [];
  }
}

/**
 * 获取单只股票的实时行情。
 */
export async function getSinaRealtimeQuote(tsCode: string): Promise<RealtimeQuote | null> {
  const quotes = await getSinaRealtimeQuotes([tsCode]);
  return quotes.length > 0 ? quotes[0] : null;
}
