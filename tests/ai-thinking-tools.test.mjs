import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { tsImport } from 'tsx/esm/api';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';

const { createAgentRunner } = await tsImport('../api/services/ai/harnessBridge.ts', import.meta.url);
const { readCompletion, thinkingSettings } = await tsImport('../api/services/ai/completionProtocol.ts', import.meta.url);
const { createResearchTools } = await tsImport('../api/services/ai/researchTools.ts', import.meta.url);
const { startResearchMcpServer } = await tsImport('../api/services/ai/researchMcpServer.ts', import.meta.url);
const { normalizeAiConfig } = await tsImport('../api/services/ai/config.ts', import.meta.url);
const config = { baseUrl: 'https://model.example/v1', apiKey: 'fixture-secret', model: 'deepseek-flash', protocol: 'deepseek', enabled: true, memoryEnabled: false, thinkingEnabled: true, reasoningEffort: 'auto' };
const signal = () => new AbortController().signal;
const snapshot = { code: '601088.SH', generatedAt: '2026-09-23', evidence: [
  { id: 'E2', title: '行情', status: 'available', source: 'fixture', data: { price: 42 } },
  { id: 'E10', title: '利润表', status: 'available', source: 'fixture-mcp', data: [{ profit: 100 }] },
] };
const tools = createResearchTools(snapshot);
const reasoning = '先核验行情，再核验财报。';
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
function stream(events, fragmented = false) {
  const data = new TextEncoder().encode(events.map(delta => `data: ${JSON.stringify(delta)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n');
  return new Response(new ReadableStream({ start(controller) {
    const size = fragmented ? 7 : data.length;
    for (let offset = 0; offset < data.length; offset += size) controller.enqueue(data.slice(offset, offset + size));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
const frame = (delta, finish_reason = null) => ({ choices: [{ index: 0, delta, finish_reason }] });

test('SSE preserves split UTF-8 reasoning, tool argument fragments and final text separately', async () => {
  const activity = [];
  const result = await readCompletion(stream([
    frame({ reasoning_content: reasoning }),
    frame({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'read_market_evidence', arguments: '{"evidence_' } }] }),
    frame({ tool_calls: [{ index: 0, function: { arguments: 'ids":["E2"]}' } }] }),
    frame({}, 'tool_calls'),
  ], true), signal(), event => activity.push(event));
  assert.equal(result.message.reasoning_content, reasoning);
  assert.equal(result.message.content, '');
  assert.deepEqual(result.message.tool_calls, [call('c1', 'read_market_evidence', { evidence_ids: ['E2'] })]);
  assert.equal(activity.filter(e => e.type === 'reasoning').map(e => e.text).join(''), reasoning);
});

test('two tool rounds replay all reasoning and exact tool IDs before generating the answer', async () => {
  const requests = [];
  const activity = [];
  const runner = createAgentRunner({ createHarness: () => { throw new Error('startup unavailable'); }, fetch: async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    assert.equal(body.temperature, undefined);
    assert.deepEqual(body.thinking, { type: 'enabled' });
    if (requests.length === 1) return stream([frame({ reasoning_content: reasoning, tool_calls: [{ index: 0, ...call('c1', 'read_market_evidence', { evidence_ids: ['E2'] }) }] }), frame({}, 'tool_calls')]);
    if (requests.length === 2) return stream([frame({ reasoning_content: '继续核验利润。', tool_calls: [{ index: 0, ...call('c2', 'read_financial_statements', { statement: 'income' }) }] }), frame({}, 'tool_calls')]);
    return stream([frame({ reasoning_content: '证据核验完成。' }), frame({ content: '最终研究结论 [E2] [E10]' }), frame({}, 'stop')]);
  } });
  const result = await runner(config, '分析', { sessionId: 'multi-tool', agentId: 'analyst', tools, onEvent: e => activity.push(e) });
  assert.equal(requests.length, 3);
  assert.equal(result.answer, '最终研究结论 [E2] [E10]');
  const history = requests[2].messages.slice(2);
  assert.equal(history[0].reasoning_content, reasoning);
  assert.equal(history[1].tool_call_id, 'c1');
  assert.equal(history[2].reasoning_content, '继续核验利润。');
  assert.equal(history[3].tool_call_id, 'c2');
  assert.equal(JSON.parse(history[1].content).evidence[0].data.price, 42);
  assert.equal(activity.filter(e => e.type === 'tool' && e.tool.status === 'completed').length, 2);
});

test('unknown tools and invalid arguments return errors without extending evidence scope', async () => {
  const scoped = createResearchTools(snapshot, ['E2']);
  assert.equal((await scoped.execute('read_financial_statements', { statement: 'income' }, signal())).isError, true);
  assert.equal((await scoped.execute('read_market_evidence', { evidence_ids: ['E2'], code: '00700.HK' }, signal())).isError, true);
  assert.equal((await scoped.execute('exec', { command: 'whoami' }, signal())).isError, true);
  assert.equal((await scoped.execute('read_market_evidence', { evidence_ids: ['E10'] }, signal())).isError, true);
  const data = await scoped.execute('read_market_evidence', { evidence_ids: ['E2'] }, signal());
  snapshot.evidence[0].data.price = 99;
  assert.equal(JSON.parse(data.content).evidence[0].data.price, 42);
  snapshot.evidence[0].data.price = 42;
});

test('thinking defaults, disabled mode, and effort validation', () => {
  const normalized = normalizeAiConfig({}, config);
  assert.equal(normalized.thinkingEnabled, true);
  assert.equal(thinkingSettings(normalized, 'quick').effort, 'low');
  assert.equal(thinkingSettings(normalized, 'deep').effort, 'max');
  assert.equal(thinkingSettings({ ...normalized, thinkingEnabled: false }).enabled, false);
  assert.throws(() => normalizeAiConfig({ reasoningEffort: 'unlimited' }, config));
});

test('interrupted streams, truncation, and runaway tool loops never produce final answers', async () => {
  await assert.rejects(readCompletion(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { headers: { 'content-type': 'text/event-stream' } }), signal()), /响应中断/);
  const runner = createAgentRunner({ fetch: async () => stream([frame({ content: 'partial' }), frame({}, 'length')]) });
  await assert.rejects(runner({ ...config, protocol: 'openai-compatible' }, '分析', { sessionId: 'length', agentId: 'a' }), /输出预算不足/);
  let count = 0;
  const loop = createAgentRunner({ fetch: async () => { count++; return stream([frame({ tool_calls: [{ index: 0, ...call(`c${count}`, 'read_market_evidence', { evidence_ids: ['E2'] }) }] }), frame({}, 'tool_calls')]); } });
  await assert.rejects(loop({ ...config, protocol: 'openai-compatible' }, '分析', { sessionId: 'loop', agentId: 'a', tools }), /轮数上限/);
  assert.equal(count, 6);
});

test('loopback MCP rejects unauthenticated requests and closes its port', async () => {
  const gateway = await startResearchMcpServer(tools.definitions, (name, args) => tools.execute(name, args, signal()));
  try {
    assert.equal((await fetch(gateway.url, { method: 'POST' })).status, 403);
    assert.equal((await fetch(gateway.url, { headers: { Authorization: `Bearer ${gateway.token}` } })).status, 405);
  } finally { await gateway.close(); }
  await assert.rejects(fetch(gateway.url));
});

test('real Harness subprocess discovers MCP, calls a tool and replays reasoning to provider', { timeout: 60_000 }, async () => {
  const requests = [];
  const activity = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const tool = body.tools?.find(item => item.function.name.endsWith('read_market_evidence'));
    const events = requests.length === 1 && tool
      ? [frame({ role: 'assistant', reasoning_content: reasoning }), frame({ tool_calls: [{ index: 0, ...call('native-call-1', tool.function.name, { evidence_ids: ['E2'] }) }] }), frame({}, 'tool_calls')]
      : [frame({ role: 'assistant', reasoning_content: '读取成功，完成分析。' }), frame({ content: '原生工具核验结论 [E2]' }), frame({}, 'stop')];
    const response = stream(events);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(await response.text());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    let startupError = '';
    const runner = createAgentRunner({ createHarness: options => {
      const harness = new DeepSeekHarness(options);
      return { start: async () => { try { await harness.start(); } catch (error) { startupError = error.message; throw error; } }, run: (...args) => harness.run(...args), close: () => harness.close() };
    } });
    const result = await runner({ ...config, baseUrl: `http://127.0.0.1:${server.address().port}` }, '调用工具读取行情后分析。', { sessionId: 'native-tools', agentId: 'analyst', tools, timeoutMs: 45_000, onEvent: e => activity.push(e) });
    assert.equal(result.runtime, 'deepseek-harness', startupError);
    assert.equal(result.answer, '原生工具核验结论 [E2]');
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].thinking, { type: 'enabled' });
    assert.equal(requests[0].reasoning_effort, 'high');
    assert.deepEqual(requests[0].tools.map(tool => tool.function.name).sort(), ['mcp__finance__read_financial_statements', 'mcp__finance__read_market_evidence']);
    const assistant = requests[1].messages.find(item => item.role === 'assistant');
    assert.equal(assistant.reasoning_content, reasoning);
    assert.equal(assistant.tool_calls[0].id, 'native-call-1');
    assert.ok(requests[1].messages.some(item => item.role === 'tool' && item.tool_call_id === 'native-call-1' && item.content.includes('42')));
    assert.ok(activity.some(e => e.type === 'reasoning' && e.text.includes(reasoning)));
    assert.ok(activity.some(e => e.type === 'tool' && e.tool.status === 'completed' && e.tool.id === 'native-call-1' && e.tool.evidenceIds.includes('E2')));
    requests.length = 0;
    const disabled = await createAgentRunner()({ ...config, thinkingEnabled: false, baseUrl: `http://127.0.0.1:${server.address().port}` }, '读取行情。', { sessionId: 'native-thinking-off', agentId: 'analyst', tools, timeoutMs: 45_000 });
    assert.equal(disabled.runtime, 'deepseek-harness');
    assert.deepEqual(requests[0].thinking, { type: 'disabled' });
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
});
