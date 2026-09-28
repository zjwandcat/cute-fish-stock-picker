import { readPersistedConfig, updatePersistedConfig, type PersistedConfig } from '../configStore.js';
import type { AiConfig, AiConfigView, AiProtocol } from './types.js';

export const HARNESS_VERSION = '0.1.6-alpha.2';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-flash';

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validateUrl(value: string, label: string): string {
  if (!value) return '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}必须是 http(s) 地址。`);
  }
  if (url.username || url.password || url.hash || value.length > 2048) throw new Error(`${label}不能包含用户名、密码或片段。`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error(`${label}必须使用 HTTPS，本机地址可使用 HTTP。`);
  }
  if ([...url.searchParams.keys()].some(key => /^(token|api[_-]?key|key|secret)$/i.test(key))) {
    throw new Error(`${label}不能把密钥放在 URL 查询参数中，请改用密钥输入框。`);
  }
  return url.toString().replace(/\/$/, '');
}

export function normalizeAiConfig(input: unknown, existing: AiConfig): AiConfig {
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const baseUrl = validateUrl(trim(body.baseUrl) || existing.baseUrl || DEFAULT_BASE_URL, '模型地址');
  const protocol = body.protocol === 'openai-compatible' || body.protocol === 'deepseek'
    ? body.protocol as AiProtocol
    : existing.protocol;
  const model = trim(body.model) || existing.model || DEFAULT_MODEL;
  if (!/^[\w.:/@-]{1,160}$/.test(model)) throw new Error('模型名称包含不支持的字符。');
  const apiKey = body.apiKey === undefined ? existing.apiKey : trim(body.apiKey);
  if (apiKey.length > 500) throw new Error('模型密钥过长。');
  if (body.reasoningEffort !== undefined && !['auto', 'low', 'high', 'max'].includes(String(body.reasoningEffort))) throw new Error('思考强度无效。');
  return {
    baseUrl,
    apiKey,
    model,
    enabled: body.enabled === undefined ? existing.enabled : body.enabled === true,
    protocol,
    memoryEnabled: body.memoryEnabled === undefined ? existing.memoryEnabled : body.memoryEnabled !== false,
    thinkingEnabled: body.thinkingEnabled === undefined ? existing.thinkingEnabled !== false : body.thinkingEnabled === true,
    reasoningEffort: body.reasoningEffort as AiConfig['reasoningEffort'] ?? existing.reasoningEffort ?? 'auto',
  };
}

export async function getAiConfig(): Promise<AiConfig> {
  return configFromPersisted(await readPersistedConfig());
}

function configFromPersisted(config: PersistedConfig): AiConfig {
  const storedModel = config.ai?.model || '';
  const model = storedModel === 'deepseek-chat' ? DEFAULT_MODEL : storedModel || DEFAULT_MODEL;
  return {
    baseUrl: config.ai?.baseUrl || DEFAULT_BASE_URL,
    apiKey: config.ai?.apiKey || '',
    model,
    enabled: config.ai?.enabled === true,
    protocol: config.ai?.protocol === 'openai-compatible' ? 'openai-compatible' : 'deepseek',
    memoryEnabled: config.ai?.memoryEnabled !== false,
    thinkingEnabled: config.ai?.thinkingEnabled !== false,
    reasoningEffort: config.ai?.reasoningEffort ?? 'auto',
  };
}

export function toAiConfigView(config: AiConfig): AiConfigView {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    enabled: config.enabled,
    protocol: config.protocol,
    apiKeyConfigured: Boolean(config.apiKey),
    tushareMcpConfigured: Boolean(process.env.TUSHARE_TOKEN?.trim()),
    memoryEnabled: config.memoryEnabled,
    harnessVersion: HARNESS_VERSION,
    thinkingEnabled: config.thinkingEnabled !== false,
    reasoningEffort: config.reasoningEffort ?? 'auto',
  };
}

export async function saveAiConfig(input: unknown): Promise<AiConfig> {
  const persisted = await updatePersistedConfig(current => ({ ...current, ai: normalizeAiConfig(input, configFromPersisted(current)) }));
  return configFromPersisted(persisted);
}
