/* 临时测试：验证 Tushare 韭菜50所需接口权限（测完删除） */
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../../.env', import.meta.url), 'utf-8');
const token = env.split('\n').find((l) => l.startsWith('TUSHARE_TOKEN'))?.split('=')[1]?.trim() ?? '';
console.log('token loaded:', token ? 'yes(len=' + token.length + ')' : 'no');

async function callApi(name: string, params: Record<string, string>, fields: string) {
  const resp = await fetch('https://api.tushare.pro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_name: name, token, params, fields }),
  });
  const json = await resp.json() as { code: number; msg: string; data?: { items: unknown[][] } };
  if (json.code !== 0) return { ok: false, msg: json.msg, rows: 0 };
  return { ok: true, msg: '', rows: json.data?.items?.length ?? 0, sample: json.data?.items?.[0] };
}

const today = '20260826';
const tests: [string, Record<string, string>, string][] = [
  ['trade_cal', { start_date: '20260601', end_date: '20260827' }, 'cal_date,is_open'],
  ['daily', { trade_date: today }, 'ts_code,trade_date,open,high,close,pct_chg,amount'],
  ['daily_basic', { trade_date: today }, 'ts_code,trade_date,turnover_rate'],
  ['stk_limit', { trade_date: today }, 'ts_code,trade_date,up_limit'],
  ['top_list', { trade_date: today }, 'ts_code,trade_date'],
  ['moneyflow', { trade_date: today }, 'ts_code,trade_date,buy_elg_amount,sell_elg_amount'],
  ['adj_factor', { trade_date: today }, 'ts_code,trade_date,adj_factor'],
  ['stock_basic', {}, 'ts_code,name,list_date,list_status'],
];

for (const [name, params, fields] of tests) {
  try {
    const r = await callApi(name, params, fields);
    console.log(`${name}: ok=${r.ok} rows=${r.rows} ${r.ok ? 'sample=' + JSON.stringify(r.sample)?.slice(0, 120) : 'msg=' + r.msg}`);
  } catch (e) {
    console.log(`${name}: EXC ${(e as Error).message}`);
  }
}
