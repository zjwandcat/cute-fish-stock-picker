import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tsImport } from 'tsx/esm/api';

const { resolveStockInput, findStockMentions } = await tsImport('../api/services/stockPool.ts', import.meta.url);
const { getTushareMcpUrl } = await tsImport('../api/services/ai/tushareMcp.ts', import.meta.url);
const { normalizeAiConfig, toAiConfigView } = await tsImport('../api/services/ai/config.ts', import.meta.url);

test('stock name in the question resolves correctly without mixing A and H shares', () => {
  assert.equal(resolveStockInput('帮我看看中国神华这个股票'), '601088.SH');
  assert.equal(resolveStockInput('中国神华'), '601088.SH');
  assert.equal(resolveStockInput('中国神华H'), '01088.HK');
  assert.equal(resolveStockInput('分析中国神华H'), '01088.HK');
  assert.equal(resolveStockInput('帮我看看601088.SH这个股票'), '601088.SH');
  assert.equal(resolveStockInput('看看00700.HK'), '00700.HK');
  assert.equal(resolveStockInput('比较中国神华与腾讯控股'), null);
  assert.equal(resolveStockInput('比较601088.SH和00700.HK'), null);
  assert.equal(resolveStockInput('中国'), null);
  assert.equal(resolveStockInput('今天市场如何'), null);
  assert.deepEqual(findStockMentions('比较中国神华A和腾讯控股').map(stock => stock.ts_code), ['601088.SH', '00700.HK']);
});

test('MCP uses the local token, ignores obsolete URLs and never exposes a credential to the UI', () => {
  const previous = process.env.TUSHARE_TOKEN;
  try {
    process.env.TUSHARE_TOKEN = 'fixture-token';
    const config = normalizeAiConfig({ tushareMcpUrl: 'https://obsolete.example/?token=old' }, {
      baseUrl: '', model: '', protocol: 'deepseek', enabled: true, apiKey: 'fixture-secret', memoryEnabled: true,
    });
    assert.equal(config.model, 'deepseek-flash');
    assert.equal(config.tushareMcpUrl, undefined);
    assert.equal(new URL(getTushareMcpUrl()).searchParams.get('token'), 'fixture-token');
    const view = toAiConfigView(config);
    assert.equal(view.tushareMcpConfigured, true);
    assert.equal(JSON.stringify(view).includes('fixture-'), false);
    delete process.env.TUSHARE_TOKEN;
    assert.equal(getTushareMcpUrl(), '');
    assert.equal(toAiConfigView(config).tushareMcpConfigured, false);
  } finally {
    if (previous === undefined) delete process.env.TUSHARE_TOKEN;
    else process.env.TUSHARE_TOKEN = previous;
  }
});
