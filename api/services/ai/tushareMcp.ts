import { Client, StreamableHTTPClientTransport, type Tool } from '@modelcontextprotocol/client';
import type { EvidenceRecord, FinanceSnapshot } from './types.js';

const READS = [
  { id: 'E10', title: '利润表', a: 'income', hk: 'hk_income' },
  { id: 'E11', title: '资产负债表', a: 'balancesheet', hk: 'hk_balancesheet' },
  { id: 'E12', title: '现金流量表', a: 'cashflow', hk: 'hk_cashflow' },
  { id: 'E17', title: '分红与公司行动', a: 'dividend', hk: '' },
] as const;

/** Official Tushare MCP accepts the existing local TUSHARE_TOKEN as a query credential. */
export function getTushareMcpUrl(): string {
  const token = process.env.TUSHARE_TOKEN?.trim();
  return token ? `https://api.tushare.pro/mcp/?token=${encodeURIComponent(token)}` : '';
}

function endpoint(value: string): URL {
  const url = new URL(value);
  if (url.origin !== 'https://api.tushare.pro' || !/^\/mcp\/?$/.test(url.pathname) || url.username || url.password || url.hash) throw new Error('MCP 地址无效。');
  return url;
}

async function connect(url: string, signal: AbortSignal): Promise<Client> {
  const client = new Client({ name: 'cute-fish-finance', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(endpoint(url), {
    // Credentials in the official endpoint must never follow a redirect.
    fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }),
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
  });
  try {
    await client.connect(transport, { signal, timeout: 12_000 });
    return client;
  } catch {
    await client.close().catch(() => undefined);
    throw new Error('Tushare MCP 连接失败，请检查地址、Token 和服务权限。');
  }
}

export async function inspectTushareMcp(url: string): Promise<{ tools: string[]; supportedReads: string[] }> {
  const signal = AbortSignal.timeout(20_000);
  const client = await connect(url, signal);
  try {
    const tools = await discover(client, signal);
    return { tools: tools.map(tool => tool.name), supportedReads: tools.filter(tool => READS.some(read => tool.name === read.a || tool.name === read.hk)).map(tool => tool.name) };
  } finally { await client.close().catch(() => undefined); }
}

async function discover(client: Client, signal: AbortSignal): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await client.listTools(cursor ? { cursor } : undefined, { signal, timeout: 10_000 });
    tools.push(...result.tools);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return tools;
}

export function readArguments(tool: Tool, code: string): Record<string, unknown> | null {
  const properties = tool.inputSchema.properties ?? {};
  const owns = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
  if (!owns(properties, 'ts_code')) return null;
  const args: Record<string, unknown> = { ts_code: code };
  const limitSchema = properties.limit;
  if (owns(properties, 'limit')) args.limit = limitSchema && typeof limitSchema === 'object' && !Array.isArray(limitSchema) && limitSchema.type === 'string' ? '8' : 8;
  // Tool schemas differ by account/version. Unknown required inputs need an explicit adapter.
  if (tool.inputSchema.required?.some(key => !owns(args, key))) return null;
  return args;
}

export function extractRows(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object' && !Array.isArray(row)));
  const object = value as Record<string, unknown>;
  if ((typeof object.code === 'number' && object.code !== 0) || object.success === false || object.error) return [];
  if (Array.isArray(object.fields) && Array.isArray(object.items)) {
    const fields = object.fields as unknown[];
    return object.items.filter(Array.isArray).map(row => Object.fromEntries(fields.map((field, index) => [String(field), row[index]])));
  }
  for (const key of ['data', 'rows', 'items', 'result']) {
    const rows = extractRows(object[key]);
    if (rows.length) return rows;
  }
  return [];
}

export async function appendMcpEvidence(snapshot: FinanceSnapshot, url: string, parentSignal: AbortSignal): Promise<void> {
  if (!url || !snapshot.code) return;
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(45_000)]);
  let client: Client | undefined;
  const records: EvidenceRecord[] = READS.map(read => ({ id: read.id, title: read.title, source: 'Tushare MCP',
    status: 'unavailable', valueKind: 'reported', asOf: null, retrievedAt: new Date().toISOString(), note: 'MCP 尚未提供可识别且有权限的对应工具。' }));
  try {
    client = await connect(url, signal);
    const tools = await discover(client, signal);
    // Sequential bounded reads avoid multiplying data calls by the number of agents.
    for (let index = 0; index < READS.length; index++) {
      signal.throwIfAborted();
      const read = READS[index];
      const tool = tools.find(item => item.name === (snapshot.market === 'HK' ? read.hk : read.a));
      const args = tool ? readArguments(tool, snapshot.code) : null;
      if (!tool || !args || tool.annotations?.destructiveHint === true) continue;
      const record = records[index];
      try {
        const result = await client.callTool({ name: tool.name, arguments: args }, { signal, timeout: 10_000 });
        if (result.isError) throw new Error('tool-error');
        let rows = extractRows(result.structuredContent);
        if (!rows.length) for (const content of result.content) {
          if (content.type !== 'text') continue;
          try { rows = extractRows(JSON.parse(content.text)); } catch { /* Unstructured text is not accepted as financial data. */ }
          if (rows.length) break;
        }
        rows = rows.filter(row => String(row.ts_code || '').toUpperCase() === snapshot.code && /^\d{8}$/.test(String(row.end_date || row.ann_date || '')))
          .sort((a, b) => String(b.end_date || b.ann_date).localeCompare(String(a.end_date || a.ann_date))).slice(0, 8);
        record.status = rows.length ? 'partial' : 'empty';
        record.data = rows;
        record.source = `Tushare MCP / ${tool.name}`;
        record.asOf = rows.length ? String(rows[0].ann_date || rows[0].end_date) : null;
        record.note = rows.length ? '仅保留最近 8 条记录，可能包含同报告期修订版；需核对报告期、币种、单位、合并范围与披露日。' : '未返回可核验的同标的结构化记录。';
      } catch {
        record.status = 'error';
        record.note = '工具读取失败或权限不足，未使用错误内容作为证据。';
      }
    }
  } catch {
    for (const record of records) if (record.status === 'unavailable') record.note = 'MCP 连接、权限或工具发现未完成。';
  } finally {
    await client?.close().catch(() => undefined);
    snapshot.evidence.push(...records);
  }
}
