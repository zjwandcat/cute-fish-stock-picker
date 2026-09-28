import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport, localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/node';
import type { ResearchTool, ResearchToolResult } from './researchTools.js';

/** Short-lived, authenticated loopback MCP bridge; no Tushare/model key crosses it. */
export async function startResearchMcpServer(definitions: ResearchTool[], execute: (name: string, args: unknown) => Promise<ResearchToolResult>) {
  const token = randomBytes(32).toString('hex');
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const connections = new Set<Server>();
  const http = createServer(async (req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    if (req.url !== '/mcp' || req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const mcp = new Server({ name: 'fish-research', version: '1.0.0' }, { capabilities: { tools: {} } });
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    connections.add(mcp);
    mcp.setRequestHandler('tools/list', async () => ({ tools: definitions.map(tool => ({
      name: tool.name, description: tool.description, inputSchema: tool.parameters,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    })) }));
    mcp.setRequestHandler('tools/call', async request => {
      const result = await execute(request.params.name, request.params.arguments ?? {});
      return { content: [{ type: 'text' as const, text: result.content }], isError: Boolean(result.isError) };
    });
    res.once('close', () => { connections.delete(mcp); void mcp.close().catch(() => undefined); });
    try { await mcp.connect(transport); await transport.handleRequest(req, res); }
    catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  http.requestTimeout = 15_000;
  http.maxHeadersCount = 30;
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('无法启动本地金融工具服务。');
  return { url: `http://127.0.0.1:${address.port}/mcp`, token,
    async close() {
      await Promise.allSettled([...connections].map(connection => connection.close()));
      await new Promise<void>(resolve => { http.close(() => resolve()); http.closeAllConnections(); });
    },
  };
}
