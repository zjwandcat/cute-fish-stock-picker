import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tsImport } from 'tsx/esm/api';

const { planResearch, validateResearchPlan, ResearchClarificationError } = await tsImport('../api/services/ai/researchPlanner.ts', import.meta.url);
const { runOrchestration } = await tsImport('../api/services/ai/orchestrator.ts', import.meta.url);
const { startResearch, getResearchProgress, stopResearch } = await tsImport('../api/services/ai/runManager.ts', import.meta.url);
const candidates = [{ code: '601088.SH', name: '中国神华' }, { code: '00700.HK', name: '腾讯控股' }];
const base = { stockCodes: candidates.map(s => s.code), questionType: 'comparison', focusAreas: ['risk'], agentIds: ['market-price'], summary: '比较风险', confidence: 0.95 };
const common = { mode: 'quick', sessionId: 'intent-test', config: {}, signal: new AbortController().signal, directoryProvider: async () => [] };

test('model searches abbreviations and verifies market before picking symbols', async () => {
  const plan = await planResearch({ ...common, question: '港股神华和腾讯，哪个股息更稳？', code: '600519.SH',
    runner: async (_config, prompt, { tools, signal }) => {
      assert.match(prompt, /界面旧标的/);
      const shenhua = JSON.parse((await tools.execute('lookup_stock', { query: '神华', market: 'HK' }, signal)).content);
      const tencent = JSON.parse((await tools.execute('lookup_stock', { query: '腾讯' }, signal)).content);
      assert.deepEqual(shenhua.stocks.map(s => s.code), ['01088.HK']);
      assert.deepEqual(tencent.stocks.map(s => s.code), ['00700.HK']);
      assert.equal((await tools.execute('lookup_stock', { query: '腾讯', command: 'exec' }, signal)).isError, true);
      return { answer: JSON.stringify({ ...base, stockCodes: ['01088.HK', '00700.HK'], researchQuestions: ['股息率和分红可持续性如何？'], timeHorizon: '长期' }), runtime: 'fallback' };
    },
  });
  assert.deepEqual(plan.stocks.map(s => s.code), ['01088.HK', '00700.HK']);
  assert.equal(plan.timeHorizon, '长期');
});

test('follow-up retains both prior stocks and new question supersedes old context', async () => {
  const history = [{ question: '比较中国神华和腾讯', answer: '', code: null, stocks: candidates }];
  const followup = await planResearch({ ...common, history, question: '这两只的风险呢？', runner: async (_config, prompt) => {
    assert.ok(prompt.includes('比较中国神华和腾讯'));
    return { answer: JSON.stringify(base), runtime: 'fallback' };
  } });
  assert.deepEqual(followup.stocks, candidates);
  const switched = await planResearch({ ...common, history, code: '601088.SH', question: '现在只看腾讯控股走势', runner: async () => ({ answer: JSON.stringify({ ...base, stockCodes: ['00700.HK'], questionType: 'single_stock' }), runtime: 'fallback' }) });
  assert.deepEqual(switched.stocks, [candidates[1]]);
});

test('ambiguous intent clarifies; more than four explicit stocks are never truncated', async () => {
  assert.throws(() => validateResearchPlan({ ...base, confidence: 0.3 }, candidates), ResearchClarificationError);
  assert.throws(() => validateResearchPlan({ ...base, needsClarification: true, clarification: '分析 A 股还是 H 股？' }, candidates), /A 股还是 H 股/);
  await assert.rejects(planResearch({ ...common, question: '比较601088.SH、00700.HK、600519.SH、600900.SH、00941.HK', runner: async () => { throw new Error('should not call model'); } }), /最多比较 4/);
});

const snapshot = { code: '601088.SH', name: '中国神华', market: 'A', generatedAt: '2026-09-25', evidence: [{ id: 'E2', title: '行情', source: 'fixture', status: 'available', data: { price: 42 } }] };
const plan = { ...base, stocks: [candidates[0]], questionType: 'single_stock' };
const input = { ...common, question: '检查神华风险', researchPlan: plan, snapshot, memories: [], onProgress: () => {} };

test('two debate sides see immutable drafts and respond once before risk review', async () => {
  const calls = new Map(), prompts = new Map();
  const result = await runOrchestration({ ...input, runner: async (_config, prompt, { agentId }) => {
    const count = (calls.get(agentId) ?? 0) + 1;
    calls.set(agentId, count);
    prompts.set(`${agentId}-${count}`, prompt);
    return { answer: `${agentId}-round${count} [E2]`, runtime: 'fallback' };
  } });
  assert.equal(calls.get('bull-case'), 2);
  assert.equal(calls.get('bear-case'), 2);
  assert.ok(!prompts.get('bear-case-1').includes('bull-case-round1'));
  assert.ok(prompts.get('bull-case-2').includes('bear-case-round1'));
  assert.ok(prompts.get('bear-case-2').includes('bull-case-round1'));
  assert.ok(!prompts.get('bear-case-2').includes('bull-case-round2'));
  assert.ok(prompts.get('risk-review-1').includes('bull-case-round2'));
  assert.ok(prompts.get('chief-analyst-1').includes('risk-review-round1'));
  assert.equal(result.agentReports.find(a => a.id === 'bull-case').debateRounds.length, 2);
  assert.ok(result.stages.includes('多空相互回应'));
});

test('failed rebuttal preserves initial argument and is disclosed to final reviewer', async () => {
  const calls = new Map();
  const result = await runOrchestration({ ...input, runner: async (_config, prompt, { agentId }) => {
    const count = (calls.get(agentId) ?? 0) + 1;
    calls.set(agentId, count);
    if (agentId === 'bull-case' && count === 2) throw new Error('模型服务返回 429');
    if (agentId === 'chief-analyst') assert.ok(prompt.includes('相互回应未完成'));
    return { answer: `${agentId} [E2]`, runtime: 'fallback' };
  } });
  const bull = result.agentReports.find(a => a.id === 'bull-case');
  assert.equal(bull.status, 'completed');
  assert.match(bull.reason, /相互回应未完成/);
  assert.equal(bull.debateRounds.length, 1);
});

test('clarification stops before data collection and retains the original question for a reply', async () => {
  const sessionId = 'clarify-manager';
  await assert.rejects(startResearch({ sessionId, mode: 'quick', question: '看看神华', config: {} }, {
    planner: async () => { throw new ResearchClarificationError('A 股还是 H 股？'); },
    buildSnapshot: async () => { throw new Error('must not fetch'); },
  }), e => e.status === 422);
  assert.equal(getResearchProgress(sessionId).total, 0);
  let receivedHistory;
  await startResearch({ sessionId, mode: 'quick', question: 'A股', config: {} }, {
    planner: async input => { receivedHistory = input.history; return plan; },
    buildSnapshot: async () => ({ snapshot: structuredClone(snapshot), bars: [] }), mcpUrl: () => '',
    orchestrate: async input => runOrchestration({ ...input, runner: async () => ({ answer: '结论 [E2]', runtime: 'fallback' }) }),
  });
  assert.equal(receivedHistory.at(-1).question, '看看神华');
  assert.equal(getResearchProgress(sessionId).status, 'completed');
});

test('cancel during planning or data collection marks stopped and sends no later requests', async () => {
  for (const phase of ['planning', 'collecting']) {
    let entered;
    const ready = new Promise(resolve => entered = resolve);
    const sessionId = `cancel-${phase}`;
    const task = startResearch({ sessionId, mode: 'quick', question: '分析神华', config: {} }, {
      planner: async () => { if (phase === 'planning') { entered(); return new Promise(() => {}); } return plan; },
      buildSnapshot: async () => { entered(); return new Promise(() => {}); },
      orchestrate: async () => { throw new Error('must not analyze'); },
    });
    const rejected = assert.rejects(task, e => e.status === 409);
    await ready;
    assert.equal(stopResearch(sessionId), true);
    await rejected;
    assert.equal(getResearchProgress(sessionId).status, 'cancelled');
  }
});

test('provider authentication failure is not presented as an ambiguous stock question', async () => {
  await assert.rejects(startResearch({ sessionId: 'planner-provider-error', mode: 'quick', question: '中国神华', config: {} }, {
    planner: async () => { throw new Error('模型服务返回 401 secret-fixture'); },
  }), e => e.status === 502 && e.message.includes('HTTP 401') && !e.message.includes('secret-fixture'));
});

test('full consultation schedules 36 roles, with bounded concurrency and both debate rounds', async () => {
  const evidence = Array.from({ length: 17 }, (_, i) => ({ id: `E${i + 2}`, title: 'fixture', source: 'fixture', status: 'available', data: { holders: [{}], moneyFlow: {} } }));
  let active = 0, maximum = 0;
  const calls = new Map();
  const result = await runOrchestration({ ...input, mode: 'deep', snapshot: { ...snapshot, evidence, stocks: [{ code: '601088.SH', name: '中国神华', market: 'A' }, { code: '00700.HK', name: '腾讯控股', market: 'HK' }] }, runner: async (_config, prompt, { agentId }) => {
    active++;
    maximum = Math.max(maximum, active);
    calls.set(agentId, (calls.get(agentId) || 0) + 1);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    const allowed = prompt.match(/本角色可引用的编号仅有：(\[E\d+\])/);
    return { answer: `已核验 ${allowed?.[1] ?? ''}`, runtime: 'fallback' };
  } });
  assert.equal(result.agentReports.length, 36);
  assert.equal(result.agentReports.filter(a => a.status === 'completed').length, 36);
  assert.ok(maximum <= 3);
  assert.equal(calls.get('bull-case'), 2);
  assert.equal(calls.get('bear-case'), 2);
});
