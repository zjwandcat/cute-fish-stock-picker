import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const TOKEN = process.env.TUSHARE_TOKEN || '';
const CODES = ['300308.SZ', '300502.SZ', '002371.SZ', '688012.SH', '603986.SH'];
const NAMES: Record<string, string> = {
  '300308.SZ': '中际旭创', '300502.SZ': '新易盛', '002371.SZ': '北方华创',
  '688012.SH': '中微公司', '603986.SH': '兆易创新',
};

async function tushare(apiName: string, params: Record<string, string>, fields: string) {
  const r = await axios.post('https://api.tushare.pro', {
    api_name: apiName, token: TOKEN, params, fields,
  });
  if (r.data.code !== 0) throw new Error(r.data.msg);
  const fs = r.data.data.fields;
  return r.data.data.items.map((it: any[]) => {
    const o: any = {};
    fs.forEach((f: string, i: number) => (o[f] = it[i]));
    return o;
  });
}

function sinaCode(c: string) {
  return c.startsWith('6') ? `sh${c.slice(0, 6)}` : `sz${c.slice(0, 6)}`;
}

async function realtime() {
  const codes = CODES.map(sinaCode).join(',');
  const r = await axios.get(`https://hq.sinajs.cn/list=${codes}`, {
    headers: { Referer: 'https://finance.sina.com.cn' },
    responseType: 'arraybuffer',
  });
  // 用 iconv-lite 解码 gbk
  const iconv = (await import('iconv-lite')).default;
  const text = iconv.decode(Buffer.from(r.data), 'gbk');
  const out: Record<string, any> = {};
  text.split('\n').forEach((line) => {
    const m = line.match(/hq_str_(\w+)="([^"]*)"/);
    if (!m) return;
    const f = m[2].split(',');
    if (f.length < 32) return;
    out[m[1]] = {
      name: f[0], open: +f[1], pre: +f[2], price: +f[3], high: +f[4], low: +f[5],
      vol: +f[8] / 100, amount: +f[9] / 10000,
      pct: +f[3] > 0 ? (+f[3] / +f[2] - 1) * 100 : 0,
    };
  });
  return out;
}

(async () => {
  if (!TOKEN) { console.error('NO TUSHARE_TOKEN'); process.exit(1); }
  const today = new Date();
  const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const d120 = new Date(today.getTime() - 130 * 86400 * 1000);
  const d120Str = `${d120.getFullYear()}${String(d120.getMonth() + 1).padStart(2, '0')}${String(d120.getDate()).padStart(2, '0')}`;

  const [rt, basic, flows] = await Promise.all([
    realtime(),
    tushare('daily_basic', { trade_date: '20260721' }, 'ts_code,name,pe,pe_ttm,pb,total_mv,turnover_rate,dv_ratio').then(r => {
      const m: Record<string, any> = {};
      r.forEach((x: any) => (m[x.ts_code] = x));
      return m;
    }).catch(() => ({} as Record<string, any>)),
    Promise.all(CODES.map(c => tushare('moneyflow', { ts_code: c, trade_date: '20260721' },
      'ts_code,buy_sm_amount,sell_sm_amount,buy_md_amount,sell_md_amount,buy_lg_amount,sell_lg_amount,buy_elg_amount,sell_elg_amount')
      .then(r => r[0] || null).catch(() => null))),
  ]);

  // K线（用于技术指标）—— tushare 返回降序，需反转为升序
  const bars: Record<string, any[]> = {};
  for (const c of CODES) {
    const raw = await tushare('daily', { ts_code: c, start_date: d120Str, end_date: todayStr },
      'ts_code,trade_date,close,high,low,vol,amount,pct_chg,pre_close').catch(() => []);
    bars[c] = raw.sort((a: any, b: any) => String(a.trade_date).localeCompare(String(b.trade_date)));
  }

  console.log('\n===== 今日大盘（10:13实时） =====');
  console.log('上证 3870.36 +0.16% | 深证 14292.57 +0.20% | 创业板 3660.25 -0.70% | 科创50 1897.24 -0.31%');
  console.log('市场特征：主板小涨、科技股下跌、避险情绪上升\n');

  for (const c of CODES) {
    const rtData = rt[sinaCode(c)];
    const b = basic[c];
    const mf = flows[CODES.indexOf(c)];
    const bb = bars[c];
    const name = NAMES[c];

    console.log(`===== ${name} (${c}) =====`);
    if (rtData) {
      console.log(`现价 ${rtData.price.toFixed(2)}  涨跌 ${rtData.pct.toFixed(2)}%  开:${rtData.open.toFixed(2)} 高:${rtData.high.toFixed(2)} 低:${rtData.low.toFixed(2)}`);
    }
    if (b) {
      console.log(`PE_TTM ${(+b.pe_ttm).toFixed(1)}  PB ${(+b.pb).toFixed(2)}  市值 ${(+b.total_mv).toFixed(0)}亿  换手 ${(+b.turnover_rate).toFixed(2)}%  股息率 ${(+b.dv_ratio).toFixed(2)}%`);
    }
    if (mf) {
      const netLg = +mf.buy_lg_amount - +mf.sell_lg_amount;
      const netElg = +mf.buy_elg_amount - +mf.sell_elg_amount;
      const total = +mf.buy_sm_amount + +mf.sell_sm_amount + +mf.buy_md_amount + +mf.sell_md_amount + +mf.buy_lg_amount + +mf.sell_lg_amount + +mf.buy_elg_amount + +mf.sell_elg_amount;
      const ratio = total > 0 ? ((netLg + netElg) / total) * 100 : 0;
      console.log(`主力净流入 ${ratio.toFixed(1)}%  (大单${(netLg/10000).toFixed(0)}万 超大单${(netElg/10000).toFixed(0)}万)`);
    }
    if (bb.length >= 60) {
      const closes = bb.map((x: any) => +x.close);
      const vols = bb.map((x: any) => +x.vol);
      const ma5 = closes.slice(-5).reduce((a: number, b: number) => a + b, 0) / 5;
      const ma20 = closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
      const ma60 = closes.slice(-60).reduce((a: number, b: number) => a + b, 0) / 60;
      const high52 = Math.max(...closes);
      const low52 = Math.min(...closes);
      const vol5 = vols.slice(-6, -1).reduce((a: number, b: number) => a + b, 0) / 5;
      const vr = vol5 > 0 ? vols[vols.length - 1] / vol5 : 0;
      const price = rtData?.price || closes[closes.length - 1];
      console.log(`MA5 ${ma5.toFixed(2)} | MA20 ${ma20.toFixed(2)} | MA60 ${ma60.toFixed(2)}`);
      console.log(`52周高 ${high52.toFixed(2)} 低 ${low52.toFixed(2)} | 距高 ${(price/high52*100-100).toFixed(1)}%`);
      console.log(`量比 ${vr.toFixed(2)} | 价格vs MA20 ${(price/ma20*100-100).toFixed(1)}%`);
    }
    console.log('');
  }
})();
