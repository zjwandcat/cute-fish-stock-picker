import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tsImport } from 'tsx/esm/api';

const { planResearch, validateResearchPlan, ResearchClarificationError } = await tsImport('../api/services/ai/researchPlanner.ts', import.meta.url);
const { selectRoutedAgents } = await tsImport('../api/services/ai/agentCatalog.ts', import.meta.url);
const { combineFinanceSnapshots } = await tsImport('../api/services/ai/runManager.ts', import.meta.url);
const { createResearchTools } = await tsImport('../api/services/ai/researchTools.ts', import.meta.url);
const candidates = [
  { code: '601088.SH', name: '中国神华' },
  { code: '00700.HK', name: '腾讯控股' },
];
const base = {
  stockCodes: candidates.map(stock => stock.code), questionType: 'comparison', focusAreas: ['valuation', 'comparison'],
  agentIds: ['market-price', 'valuation-pe', 'ah-premium'], summary: '比较两只股票的行情和估值差异。', confidence: 0.98,
};

test('planner asks the model to classify question, stocks and specialist IDs before research', async () => {
  let prompt = '';
  const plan = await planResearch({ question: '比较中国神华和腾讯控股估值，哪些更值得长期跟踪？', mode: 'deep', sessionId: 'planner-test', config: {}, signal: new AbortController().signal,
    directoryProvider: async () => [],
    runner: async (_config, value, options) => { prompt = value; assert.equal(options.agentId, 'question-router'); return { answer: JSON.stringify(base), runtime: 'fallback' }; },
  });
  assert.deepEqual(plan.stocks, candidates);
  assert.equal(plan.questionType, 'comparison');
  assert.ok(prompt.includes('valuation-pe'));
  assert.match(prompt, /比较中国神华和腾讯控股估值/);
  assert.equal(plan.agentIds.length, 32);
  assert.deepEqual(plan.agentIds.slice(0, 3), base.agentIds);
});

test('planner resolves listed shares outside the local watchlist using the directory', async () => {
  const plan = await planResearch({ question: '分析贵州茅台的估值和股息', mode: 'quick', sessionId: 'planner-directory', config: {}, signal: new AbortController().signal,
    directoryProvider: async () => [{ ts_code: '600519.SH', name: '贵州茅台', market: 'A' }],
    runner: async () => ({ answer: JSON.stringify({ ...base, stockCodes: ['600519.SH'], questionType: 'single_stock', agentIds: ['valuation-pe'], summary: '核查估值和股息' }), runtime: 'fallback' }),
  });
  assert.deepEqual(plan.stocks, [{ code: '600519.SH', name: '贵州茅台' }]);
  assert.equal(plan.questionType, 'single_stock');
});

test('planner recognizes A and H listings as separate stocks in a paired comparison', async () => {
  const plan = await planResearch({ question: '比较中国神华A股和H股的估值差异', mode: 'standard', sessionId: 'planner-ah', config: {}, signal: new AbortController().signal,
    directoryProvider: async () => [],
    runner: async () => ({ answer: JSON.stringify({ ...base, stockCodes: ['601088.SH', '01088.HK'], questionType: 'comparison' }), runtime: 'fallback' }),
  });
  assert.deepEqual(plan.stocks.map(stock => stock.code), ['601088.SH', '01088.HK']);
});

test('planner rejects invented symbols, missing comparison sides, and absent tickers', () => {
  assert.throws(() => validateResearchPlan({ ...base, stockCodes: ['000001.SZ'] }, candidates), /股票目录匹配/);
  assert.throws(() => validateResearchPlan({ ...base, stockCodes: ['601088.SH'] }, candidates), /全部纳入/);
  assert.throws(() => validateResearchPlan({ ...base, stockCodes: [], clarification: '请补充股票。' }, candidates), /请补充股票/);
});

test('routed agent depth caps select only requested specialists and retain debate and final roles', () => {
  const allSpecialists = ['market-price', 'price-action', 'volume', 'trend', 'momentum', 'technical-divergence', 'volatility', 'liquidity', 'valuation-pe', 'valuation-pb', 'dividend', 'size-turnover', 'shareholders', 'ownership-concentration', 'moneyflow', 'flow-price', 'ah-premium', 'fx-basis', 'crowding', 'data-quality', 'market-structure', 'earnings', 'balance-sheet', 'cash-flow', 'growth', 'sector', 'macro', 'news', 'disclosures', 'southbound', 'corporate-actions', 'portfolio'];
  const deep = selectRoutedAgents('deep', allSpecialists, 'comparison');
  assert.equal(deep.length, 36);
  assert.equal(deep.at(-1).id, 'chief-analyst');
  const standard = selectRoutedAgents('standard', allSpecialists, 'comparison');
  assert.equal(standard.filter(agent => agent.phase === 'analysis').length, 11);
  assert.deepEqual(selectRoutedAgents('quick', ['trend'], 'single_stock').map(agent => agent.id), ['trend', 'bull-case', 'bear-case', 'risk-review', 'chief-analyst']);
});

test('multi-stock evidence gets unique citations and tools return the matching stock metadata', async () => {
  const combined = combineFinanceSnapshots([
    { code: '601088.SH', name: '中国神华', market: 'A', generatedAt: '2026-09-23', evidence: [
      { id: 'E2', title: '实时行情', source: 'fixture', status: 'available', valueKind: 'reported', asOf: '20260923', retrievedAt: '2026-09-23', data: { price: 42 } },
      { id: 'E10', title: '利润表', source: 'Tushare MCP', status: 'partial', valueKind: 'reported', asOf: '20260630', retrievedAt: '2026-09-23', data: [{ profit: 100 }] },
    ] },
    { code: '00700.HK', name: '腾讯控股', market: 'HK', generatedAt: '2026-09-23', evidence: [
      { id: 'E2', title: '实时行情', source: 'fixture', status: 'available', valueKind: 'reported', asOf: '20260923', retrievedAt: '2026-09-23', data: { price: 600 } },
      { id: 'E10', title: '利润表', source: 'Tushare MCP', status: 'partial', valueKind: 'reported', asOf: '20260630', retrievedAt: '2026-09-23', data: [{ profit: 200 }] },
    ] },
  ]);
  assert.deepEqual(combined.evidence.map(item => item.id), ['E1', 'E2', 'E3', 'E4']);
  const tools = createResearchTools(combined);
  const statements = await tools.execute('read_financial_statements', { statement: 'income' }, new AbortController().signal);
  const evidence = JSON.parse(statements.content).evidence;
  assert.deepEqual(evidence.map(item => [item.id, item.stockCode, item.stockName]), [
    ['E2', '601088.SH', '中国神华'], ['E4', '00700.HK', '腾讯控股'],
  ]);
  assert.deepEqual(statements.evidenceIds, ['E2', 'E4']);
});
