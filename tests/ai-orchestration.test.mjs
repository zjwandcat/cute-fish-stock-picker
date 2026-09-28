import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tsImport } from 'tsx/esm/api';

const { runOrchestration } = await tsImport('../api/services/ai/orchestrator.ts', import.meta.url);
const { selectRoutedAgents } = await tsImport('../api/services/ai/agentCatalog.ts', import.meta.url);
const snapshot = { code: '601088.SH', name: '中国神华', market: 'A', generatedAt: new Date().toISOString(), evidence: [
  { id: 'E2', title: '行情', source: 'fixture', status: 'available', valueKind: 'reported', data: { price: 42 } },
  { id: 'E9', title: '新闻', source: 'fixture', status: 'unavailable', note: '尚未取得新闻数据' },
] };
const input = { sessionId: 'test-citations', config: {}, mode: 'quick', question: '中国神华风险', researchPlan: {
  stocks: [{ code: '601088.SH', name: '中国神华' }], questionType: 'single_stock', focusAreas: ['price', 'risk'],
  agentIds: ['market-price', 'data-quality'], summary: '检查行情和主要风险', confidence: 0.95,
}, snapshot, memories: [], signal: new AbortController().signal, onProgress: () => {} };

test('a bad citation gets one bounded revision and unavailable data has no factual citation ID', async () => {
  const calls = new Map();
  const result = await runOrchestration({ ...input, runner: async (_config, prompt, { agentId }) => {
    const attempt = (calls.get(agentId) ?? 0) + 1;
    calls.set(agentId, attempt);
    if (agentId === 'chief-analyst' && attempt === 1) {
      assert.ok(!prompt.includes('"id":"E9"'));
      assert.ok(prompt.includes('尚未取得新闻数据'));
      return { answer: '新闻缺失 [E9]', runtime: 'fallback' };
    }
    return { answer: '价格为 42 [E2]；新闻待核验。', runtime: 'fallback' };
  } });
  assert.equal(calls.get('chief-analyst'), 2);
  assert.match(result.answer, /42 \[E2\]/);
  assert.ok(result.agentReports.every(a => a.status === 'completed' || a.status === 'skipped'));
});

test('persistent invented citations still fail after one revision', async () => {
  let finalCalls = 0;
  let latest = [];
  await assert.rejects(runOrchestration({ ...input, onProgress: reports => latest = reports, runner: async (_config, _prompt, { agentId }) => {
    if (agentId === 'chief-analyst') { finalCalls++; return { answer: '无法核验的数字 [E99]', runtime: 'fallback' }; }
    return { answer: '价格 [E2]', runtime: 'fallback' };
  } }));
  assert.equal(finalCalls, 2);
  assert.equal(latest.find(a => a.id === 'chief-analyst').reason, '引用了不可用证据：E99。');
});

test('provider access failure is displayed and never retried by citation repair', async () => {
  const calls = new Map();
  let latest = [];
  await assert.rejects(runOrchestration({ ...input, onProgress: reports => latest = reports, runner: async (_config, _prompt, { agentId }) => {
    calls.set(agentId, (calls.get(agentId) ?? 0) + 1);
    throw new Error('模型服务返回 401');
  } }));
  assert.ok([...calls.values()].every(count => count === 1));
  assert.ok(latest.filter(a => a.status === 'failed').every(a => a.reason.includes('HTTP 401')));
});

test('question-selected specialists drive the actual analysis queue', async () => {
  const plan = { ...input.researchPlan, questionType: 'single_stock', agentIds: ['market-price'] };
  const result = await runOrchestration({ ...input, researchPlan: plan, runner: async (_config, _prompt, { agentId }) => ({ answer: `研究 [E2]`, runtime: 'fallback' }) });
  assert.deepEqual(result.agentReports.map(report => report.id), selectRoutedAgents('quick', ['market-price'], 'single_stock').map(agent => agent.id));
  assert.equal(result.agentReports.filter(report => report.phase === 'analysis').length, 1);
});
