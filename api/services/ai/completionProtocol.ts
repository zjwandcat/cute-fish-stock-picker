import type { AiConfig } from './types.js';
import type { AgentActivity } from './researchTypes.js';
import type { ResearchTools, ResearchToolResult } from './researchTools.js';

export const MAX_MODEL_STEPS = 6;
export const MAX_TOOL_CALLS = 12;
export type WireToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type WireAssistant = { role: 'assistant'; content: string | null; reasoning_content?: string; tool_calls?: WireToolCall[] };
type WireMessage = WireAssistant | { role: 'system' | 'user'; content: string } | { role: 'tool'; tool_call_id: string; content: string };

export interface ThinkingSettings { enabled: boolean; effort: 'low' | 'high' | 'max'; maxTokens: number; timeoutMs: number }
export function thinkingSettings(config: AiConfig, mode = 'standard'): ThinkingSettings {
  const enabled = config.protocol === 'deepseek' && config.thinkingEnabled !== false;
  const effort = config.reasoningEffort && config.reasoningEffort !== 'auto' ? config.reasoningEffort : mode === 'quick' ? 'low' : mode === 'deep' ? 'max' : 'high';
  return { enabled, effort, maxTokens: enabled ? ({ low: 8192, high: 16384, max: 32768 }[effort]) : 4096, timeoutMs: enabled ? ({ low: 150_000, high: 240_000, max: 300_000 }[effort]) : 90_000 };
}

/** Assemble SSE by tool index, preserving exact reasoning for every tool round. */
export async function readCompletion(response: Response, signal: AbortSignal, onEvent?: (event: AgentActivity) => void): Promise<{ message: WireAssistant; finishReason: string }> {
  const message: WireAssistant = { role: 'assistant', content: '', reasoning_content: '' };
  const calls = new Map<number, WireToolCall>();
  let finishReason = '';
  let bytes = 0;
  const consume = (value: unknown, streaming: boolean) => {
    if (!value || typeof value !== 'object') throw new Error('模型服务返回了无法解析的响应。');
    const body = value as { error?: unknown; choices?: Array<{ index?: number; finish_reason?: string; delta?: Record<string, unknown>; message?: Record<string, unknown> }> };
    if (body.error) throw new Error('模型服务在流式响应中报告错误。');
    const choice = body.choices?.find(c => (c.index ?? 0) === 0);
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = streaming ? choice.delta : choice.message;
    if (!delta) return;
    if (typeof delta.reasoning_content === 'string') { message.reasoning_content += delta.reasoning_content; onEvent?.({ type: 'reasoning', text: delta.reasoning_content }); }
    if (typeof delta.content === 'string' && delta.content) { message.content += delta.content; onEvent?.({ type: 'phase', phase: 'answering' }); }
    if (Array.isArray(delta.tool_calls)) for (const [ordinal, raw] of delta.tool_calls.entries()) {
      const call = raw as { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } };
      const index = call.index ?? ordinal;
      if (!Number.isInteger(index) || index < 0 || index >= MAX_TOOL_CALLS || (call.type && call.type !== 'function')) throw new Error('模型工具调用格式无效。');
      const previous = calls.get(index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
      previous.id += call.id ?? '';
      previous.function.name += call.function?.name ?? '';
      previous.function.arguments += call.function?.arguments ?? '';
      calls.set(index, previous);
    }
  };
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    consume(await response.json().catch(() => { throw new Error('模型服务返回了无法解析的响应。'); }), false);
  } else {
    if (!response.body) throw new Error('模型服务没有返回可显示的回答。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    try {
      while (!done) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) { buffer += decoder.decode(); break; }
        bytes += chunk.value.byteLength;
        if (bytes > 4 * 1024 * 1024) throw new Error('模型响应超过本次大小上限。');
        buffer += decoder.decode(chunk.value, { stream: true });
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          if (data === '[DONE]') { done = true; break; }
          let value: unknown;
          try { value = JSON.parse(data); } catch { throw new Error('模型服务返回了无法解析的响应。'); }
          consume(value, true);
        }
      }
      if (!done || !finishReason) throw new Error('模型响应中断，未收到完整结束标记。');
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  signal.throwIfAborted();
  if (calls.size) {
    message.tool_calls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    if (message.tool_calls.some(call => !call.id || !call.function.name) || new Set(message.tool_calls.map(call => call.id)).size !== calls.size) throw new Error('模型工具调用格式无效。');
  }
  return { message, finishReason };
}

export async function runCompletionLoop(input: {
  config: AiConfig; prompt: string; systemPrompt: string; signal: AbortSignal; request: typeof fetch;
  thinking: ThinkingSettings; tools?: ResearchTools; execute: (name: string, args: unknown, id: string) => Promise<ResearchToolResult>;
  onEvent?: (event: AgentActivity) => void;
}): Promise<string> {
  const { config, signal, thinking, onEvent } = input;
  // This conversation lives only for this role/run. Never trim reasoning from
  // assistant messages: tools require its replay, including tool-free rounds.
  const messages: WireMessage[] = [{ role: 'system', content: input.systemPrompt }, { role: 'user', content: input.prompt }];
  const definitions = input.tools?.definitions ?? [];
  for (let step = 0; step < MAX_MODEL_STEPS; step++) {
    signal.throwIfAborted();
    onEvent?.({ type: 'phase', phase: thinking.enabled ? 'thinking' : 'answering' });
    let response: Response;
    try {
      response = await input.request(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, messages, max_tokens: thinking.maxTokens, stream: true, stream_options: { include_usage: true },
          ...(config.protocol === 'deepseek' ? { thinking: { type: thinking.enabled ? 'enabled' : 'disabled' }, ...(thinking.enabled ? { reasoning_effort: thinking.effort } : {}) } : {}),
          ...(!thinking.enabled ? { temperature: 0.2 } : {}),
          ...(definitions.length ? { tools: definitions.map(tool => ({ type: 'function', function: tool })) } : {}),
        }), signal, redirect: 'error',
      });
    } catch { signal.throwIfAborted(); throw new Error('无法连接模型服务，请检查模型地址和网络。'); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`模型服务返回 ${response.status}，请检查模型配置或额度。`); }
    const { message, finishReason } = await readCompletion(response, signal, onEvent);
    if (finishReason === 'length') throw new Error('模型输出预算不足，未生成完整回答。请降低思考强度或缩小问题范围。');
    if (finishReason && !['stop', 'tool_calls'].includes(finishReason)) throw new Error('模型服务未正常完成本次回答。');
    messages.push(message);
    if (!message.tool_calls?.length) {
      if (!message.content?.trim()) throw new Error('模型服务没有返回可显示的回答。');
      return message.content.trim();
    }
    for (const call of message.tool_calls) {
      signal.throwIfAborted();
      let args: unknown;
      try { args = JSON.parse(call.function.arguments); } catch { args = null; }
      const result = await input.execute(call.function.name, args, call.id);
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.content });
    }
  }
  throw new Error('已达到本次工具分析轮数上限，请缩小问题范围。');
}
