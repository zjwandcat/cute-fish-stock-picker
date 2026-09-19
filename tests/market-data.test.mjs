import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'tsx/esm/api';
register();
const { parseTencentValues, selectMarketValue } = await import('../api/services/marketValue.ts');
const { getOverridePrice } = await import('../api/services/priceOverride.ts');
const { getDailyBars, getDailyBasicBatch } = await import('../api/services/tushare.ts');
const { default: axios } = await import('axios');

test('Tencent validates identity, timestamp, positive values and converts yi to wan', () => {
  const f = Array(88).fill('');
  f[2] = '600519'; f[3] = '1258'; f[30] = '20260916161500'; f[45] = '15726.03';
  const parse = () => parseTencentValues(`v_sh600519="${f.join('~')}";`, ['600519.SH']);
  assert.equal(parse().get('600519.SH').value, 157260300);
  assert.equal(parse().get('600519.SH').as_of, '20260916');
  f[45] = 'NaN'; assert.equal(parse().size, 0);
  f[45] = '1'; f[2] = '600000'; assert.equal(parse().size, 0);
  f[2] = '600519'; f[30] = ''; assert.equal(parse().size, 0);
});

test('same-date conflict fails closed; newer quote and stale dates are explicit', () => {
  const b = { total_mv: 10000, trade_date: '20260916' };
  const q = { value: 12000, as_of: '20260916', source: 'tencent', currency: 'CNY' };
  const select = (basic, quote) => selectMarketValue('600519.SH', basic, quote, ['20260917','20260916'], '20260917');
  assert.equal(select(b, q).status, 'conflict');
  assert.equal(select(b, q).value, null);
  assert.equal(select(b, { ...q, value: 10001 }).status, 'previous_close');
  assert.equal(select(b, { ...q, as_of: '20260917' }).source, 'tencent');
  assert.equal(select({ ...b, trade_date: '20260910' }, undefined).status, 'stale');
  assert.equal(select(undefined, undefined).value, null);
  assert.equal(getOverridePrice('688256.SH'), null);
});

test('market fallback uses open days and history is chronological; invalid OHLC rejected', async () => {
  const original = axios.post;
  const token = process.env.TUSHARE_TOKEN;
  process.env.TUSHARE_TOKEN = 'test';
  const calls = [];
  axios.post = async (_url, body) => {
    calls.push(body);
    let items = [];
    const fields = body.fields.split(',');
    if (body.api_name === 'trade_cal') items = [['20260917',1],['20260916',1],['20260915',1]];
    if (body.api_name === 'daily_basic' && body.params.trade_date === '20260916') {
      items = [fields.map(f => ({ ts_code:'600519.SH', trade_date:'20260916', close:1258, total_mv:157260265.28 }[f] ?? 0))];
    }
    if (body.api_name === 'daily') items = ['20260916','20260915'].map(d => fields.map(f => ({
      ts_code: body.params.ts_code, trade_date:d, open:10, high:body.params.ts_code === 'BAD.SH' ? 1 : 12,
      low:9, close:11, vol:100, amount:1000 }[f] ?? 0)));
    return { data: { code: 0, data: { fields, items } } };
  };
  try {
    const values = await getDailyBasicBatch(['600519.SH'], '20260917');
    assert.equal(values.get('600519.SH').trade_date, '20260916');
    assert.ok(!calls.some(c => c.params.trade_date === '20260912'));
    const bars = await getDailyBars('600519.SH','20260901','20260917');
    assert.deepEqual(bars.map(b => b.trade_date), ['20260915','20260916']);
    assert.deepEqual(await getDailyBars('BAD.SH','20260901','20260917'), []);
  } finally { axios.post = original; if (token === undefined) delete process.env.TUSHARE_TOKEN; else process.env.TUSHARE_TOKEN = token; }
});
