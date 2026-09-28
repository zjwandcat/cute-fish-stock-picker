import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { tsImport } from 'tsx/esm/api';

const { createAgentRunner, runtimePatchPath, stopResearch } = await tsImport('../api/services/ai/harnessBridge.ts', import.meta.url);
const config = { baseUrl: 'https://model.example/v1', apiKey: 'fixture-secret', model: 'fixture-model', protocol: 'deepseek', enabled: true, memoryEnabled: false };
const options = (name, extra = {}) => ({ sessionId: `test-${name}`, agentId: 'analyst', ...extra });
const waitFor = async predicate => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('fixture did not start');
};

test('Harness uses isolated home, bounded model output, no inherited credentials, and always closes', async () => {
  let launch;
  let closed = 0;
  const previous = process.env.AWS_SECRET_ACCESS_KEY;
  process.env.AWS_SECRET_ACCESS_KEY = 'unrelated-fixture-secret';
  const runner = createAgentRunner({ createHarness: value => {
    launch = value;
    return { start: async () => {}, run: async () => ({ finalResponse: 'Finding [E1]' }), close: async () => { closed++; } };
  }, fetch: async () => { throw new Error('unexpected fallback'); } });
  try {
    const result = await runner(config, 'Analyze supplied evidence', options('success'));
    assert.equal(result.runtime, 'deepseek-harness');
    assert.equal(result.answer, 'Finding [E1]');
    assert.equal(closed, 1);
    assert.equal(launch.env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(launch.env.FISH_TUSHARE_MCP_URL, undefined);
    assert.equal(launch.env.DSH_TELEMETRY_DISABLED, '1');
    assert.equal(launch.cwd, launch.dshHome);
    assert.equal(launch.processCwd, launch.dshHome);
    assert.equal(launch.maxTokens, 16384);
    assert.equal(launch.reasoningEffort, 'high');
    assert.equal(existsSync(launch.dshHome), false);
    assert.equal(existsSync(runtimePatchPath()), true);
  } finally {
    if (previous === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = previous;
  }
});

test('cancelling an active Harness closes it without starting fallback', async () => {
  let started = false;
  let closed = 0;
  let fetched = 0;
  const controller = new AbortController();
  const runner = createAgentRunner({
    createHarness: () => ({ start: async () => {}, run: () => { started = true; return new Promise(() => {}); }, close: async () => { closed++; } }),
    fetch: async () => { fetched++; throw new Error('unexpected fallback'); },
  });
  const task = runner(config, 'Question', options('cancel', { signal: controller.signal }));
  const rejected = assert.rejects(task, error => error.name === 'AbortError');
  await waitFor(() => started);
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await rejected;
  assert.equal(closed, 1);
  assert.equal(fetched, 0);
});

test('timeout closes Harness and does not retry a charged model turn', async () => {
  let closed = 0;
  let fetched = 0;
  const runner = createAgentRunner({
    createHarness: () => ({ start: async () => {}, run: () => new Promise(() => {}), close: async () => { closed++; } }),
    fetch: async () => { fetched++; throw new Error('unexpected fallback'); },
  });
  await assert.rejects(runner(config, 'Question', options('timeout', { timeoutMs: 40 })), error => error.name === 'TimeoutError');
  assert.equal(closed, 1);
  assert.equal(fetched, 0);
});

test('startup failure may fallback; model-turn failure must not be replayed or leak diagnostics', async () => {
  let fetched = 0;
  const request = async () => { fetched++; return Response.json({ choices: [{ message: { content: 'Compatible result' } }] }); };
  const startup = createAgentRunner({ createHarness: () => ({ start: async () => { throw new Error('fixture-secret'); }, run: async () => { throw new Error('unreachable'); }, close: async () => {} }), fetch: request });
  assert.equal((await startup(config, 'Question', options('startup'))).runtime, 'fallback');
  const turn = createAgentRunner({ createHarness: () => ({ start: async () => {}, run: async () => { throw new Error('fixture-secret'); }, close: async () => {} }), fetch: request });
  await assert.rejects(turn(config, 'Question', options('turn')), error => !error.message.includes('fixture-secret'));
  assert.equal(fetched, 1);
});

test('stopResearch aborts compatible requests and a pre-aborted run sends no request', async () => {
  let signal;
  let requests = 0;
  const runner = createAgentRunner({ fetch: async (_url, init) => { signal = init.signal; requests++; return new Promise(() => {}); } });
  const task = runner({ ...config, protocol: 'openai-compatible' }, 'Question', options('stop'));
  const rejected = assert.rejects(task, error => error.name === 'AbortError');
  await waitFor(() => signal);
  assert.equal(await stopResearch('test-stop'), true);
  await rejected;
  assert.equal(signal.aborted, true);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runner(config, 'Question', options('before', { signal: controller.signal })), error => error.name === 'AbortError');
  assert.equal(requests, 1);
});

test('runtime constructor failure falls back before a model turn and preserves DeepSeek thinking', async () => {
  let requests = 0;
  const runner = createAgentRunner({
    createHarness: () => { throw new Error('runtime metadata unavailable'); },
    fetch: async (_url, init) => {
      requests++;
      const request = JSON.parse(init.body);
      assert.deepEqual(request.thinking, { type: 'enabled' });
      assert.equal(request.reasoning_effort, 'high');
      assert.equal(request.temperature, undefined);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '研究结论 [E2]' } }] });
    },
  });
  const result = await runner(config, 'Question', options('constructor'));
  assert.equal(result.runtime, 'fallback');
  assert.equal(requests, 1);
});

test('reasoning-only token exhaustion is explicit and never exposed as the answer', async () => {
  const runner = createAgentRunner({ fetch: async () => Response.json({
    choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'private-reasoning' } }],
  }) });
  await assert.rejects(runner({ ...config, protocol: 'openai-compatible' }, 'Question', options('budget')),
    error => error.message.includes('输出预算不足') && !error.message.includes('private-reasoning'));
});

test('Harness max-tokens rejects partial output and does not retry the model', async () => {
  const runner = createAgentRunner({ createHarness: () => ({ start: async () => {}, run: async (_prompt, options) => {
    options.onNotification({ method: 'session.event', params: { event: { type: 'turn/end', data: { reason: { kind: 'max-tokens' } } } } });
    return { finalResponse: 'incomplete answer' };
  }, close: async () => {} }), fetch: async () => { throw new Error('unexpected retry'); } });
  await assert.rejects(runner(config, 'Question', options('native-length')), /输出预算不足/);
});
