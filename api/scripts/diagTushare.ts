/** 诊断 bagholder50 数据拉取：单日整表行数、分页行为、限流情况 */
import axios from 'axios';
import 'dotenv/config';

const TUSHARE_API_URL = 'https://api.tushare.pro';

async function req(apiName: string, params: Record<string, string | number>, fields: string) {
  const token = process.env.TUSHARE_TOKEN || '';
  const resp = await axios.post(
    TUSHARE_API_URL,
    { api_name: apiName, token, params, fields },
    { timeout: 30_000 },
  );
  const { code, msg, data } = resp.data;
  if (code !== 0) return { ok: false, msg, rows: [] as unknown[][] };
  return { ok: true, msg: '', rows: data?.items ?? [] };
}

async function main() {
  const d = '20260826';

  // 1) daily 单日整表（无 offset）
  const daily1 = await req('daily', { trade_date: d }, 'ts_code,trade_date,close,high');
  console.log(`daily 无offset: ${daily1.rows.length} rows (ok=${daily1.ok})`);

  // 2) daily offset=5000
  const daily2 = await req('daily', { trade_date: d, offset: 5000 }, 'ts_code,trade_date,close,high');
  console.log(`daily offset=5000: ${daily2.rows.length} rows (ok=${daily2.ok})`);

  // 3) daily_basic 单日整表
  const basic1 = await req('daily_basic', { trade_date: d }, 'ts_code,trade_date,turnover_rate,total_mv');
  console.log(`daily_basic 无offset: ${basic1.rows.length} rows (ok=${basic1.ok})`);
  if (basic1.ok && basic1.rows.length > 0) {
    console.log('  fields sample:', JSON.stringify(basic1.rows[0]));
  }

  // 4) daily_basic offset=5000
  const basic2 = await req('daily_basic', { trade_date: d, offset: 5000 }, 'ts_code,trade_date,turnover_rate,total_mv');
  console.log(`daily_basic offset=5000: ${basic2.rows.length} rows (ok=${basic2.ok})`);

  // 5) moneyflow 单日整表 + 第二页
  const mf1 = await req('moneyflow', { trade_date: d }, 'ts_code,trade_date,buy_elg_amount,sell_elg_amount');
  console.log(`moneyflow 无offset: ${mf1.rows.length} rows (ok=${mf1.ok})`);
  const mf2 = await req('moneyflow', { trade_date: d, offset: 5000 }, 'ts_code,trade_date,buy_elg_amount,sell_elg_amount');
  console.log(`moneyflow offset=5000: ${mf2.rows.length} rows (ok=${mf2.ok})`);

  // 6) 连续 10 次 daily_basic 快速请求，统计失败率（模拟并发拉取限流）
  let fail = 0;
  for (let i = 0; i < 10; i++) {
    const dd = `202608${String(11 + i).padStart(2, '0')}`;
    const r = await req('daily_basic', { trade_date: dd, offset: 5000 }, 'ts_code,trade_date,turnover_rate');
    if (!r.ok || r.rows.length === 0) {
      fail++;
      console.log(`  连续请求第${i + 1}次(${dd}) 失败: ok=${r.ok} msg=${r.msg} rows=${r.rows.length}`);
    }
  }
  console.log(`连续10次 offset=5000 daily_basic: 失败 ${fail}/10`);
}

main().catch((e) => console.error(e));
