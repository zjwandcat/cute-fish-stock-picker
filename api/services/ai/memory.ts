import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DATA_DIRECTORY, dataFile } from '../dataDirectory.js';
import { normalizeCode } from '../stockPool.js';
import type { FinanceSnapshot } from './types.js';

export interface MemoryItem {
  id: string;
  kind: 'preference' | 'watchlist' | 'research';
  text: string;
  code?: string;
  sourceEvidenceIds?: string[];
  provenance?: {
    sessionId: string;
    snapshotAt: string;
    sources: { id: string; title: string; source: string; asOf: string | null; retrievedAt: string }[];
  };
  createdAt: string;
  expiresAt?: string;
}

const MEMORY_FILE = dataFile('ai-memory.json');
const MAX_ITEMS = 200;
const RESEARCH_TTL = 14 * 24 * 60 * 60 * 1000;
let writes: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const pending = writes.then(task);
  writes = pending.catch(() => undefined);
  return pending;
}

async function readAll(): Promise<MemoryItem[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(MEMORY_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((item): item is MemoryItem => Boolean(
      item && typeof item === 'object' && typeof item.id === 'string' && typeof item.text === 'string'
      && ['preference', 'watchlist', 'research'].includes(item.kind) && Number.isFinite(Date.parse(item.createdAt)),
    )).slice(0, MAX_ITEMS) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeAll(items: MemoryItem[]): Promise<void> {
  await mkdir(DATA_DIRECTORY, { recursive: true });
  const temporary = `${MEMORY_FILE}.tmp`;
  await writeFile(temporary, JSON.stringify(items, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, MEMORY_FILE);
}

function active(items: MemoryItem[]): MemoryItem[] {
  const now = Date.now();
  return items.filter((item) => !item.expiresAt || Date.parse(item.expiresAt) > now);
}

export async function listMemory(limit = 50): Promise<MemoryItem[]> {
  await writes;
  const items = active(await readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items.slice(0, Math.max(1, Math.min(limit, 200)));
}

export async function addMemory(input: Omit<MemoryItem, 'id' | 'createdAt'>): Promise<MemoryItem> {
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000) throw new Error('记忆内容不能为空且不能超过 2000 个字符。');
  if (!['preference', 'watchlist', 'research'].includes(input.kind)) throw new Error('记忆类型无效。');
  if (/(?:[?&](?:token|api[_-]?key)=|\bsk-[\w-]{12,}|\bBearer\s+\S+|(?:api[_ -]?key|token|密钥)\s*[:=]\s*\S{8,})/i.test(input.text)) {
    throw new Error('请勿在长期记忆中保存密钥或带认证信息的链接。');
  }
  const code = input.code ? normalizeCode(input.code) : undefined;
  if (input.code && !code) throw new Error('记忆的股票代码无效。');
  if (input.kind === 'research' && (!code || !input.provenance?.sources.length)) throw new Error('研究记忆需要标的和可追溯来源。');
  let expiresAt = input.expiresAt;
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) throw new Error('记忆过期时间无效。');
  if (input.kind === 'research') expiresAt = new Date(Math.min(Date.parse(expiresAt || '') || Infinity, Date.now() + RESEARCH_TTL)).toISOString();
  const item: MemoryItem = {
    kind: input.kind, text: input.text.trim(), code: code || undefined, expiresAt,
    sourceEvidenceIds: input.sourceEvidenceIds, provenance: input.provenance,
    id: `mem_${randomUUID()}`, createdAt: new Date().toISOString(),
  };
  return serialize(async () => {
    const items = active(await readAll()).filter(existing => !(existing.kind === item.kind && existing.code === item.code && existing.text === item.text));
    await writeAll([item, ...items].slice(0, MAX_ITEMS));
    return item;
  });
}

export async function deleteMemory(id: string): Promise<boolean> {
  return serialize(async () => {
    const items = await readAll();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) return false;
    await writeAll(next);
    return true;
  });
}

export async function retrieveMemory(code?: string | null): Promise<string[]> {
  const normalized = code ? normalizeCode(code) : null;
  return (await listMemory(MAX_ITEMS))
    .filter(item => (!item.code || item.code === normalized) && (item.kind !== 'research' || Boolean(normalized && item.provenance?.sources.length)))
    .slice(0, 12)
    .map(item => JSON.stringify({ kind: item.kind, text: item.text, code: item.code, createdAt: item.createdAt, expiresAt: item.expiresAt, provenance: item.provenance,
      ...(item.kind === 'research' ? { warning: '历史研究观点，仅用于追踪变化；必须用本次数据重新核验。' } : {}) }));
}

export async function saveResearchMemory(sessionId: string, answer: string, snapshot: FinanceSnapshot): Promise<MemoryItem | null> {
  if (snapshot.stocks?.length) {
    let first: MemoryItem | null = null;
    for (const stock of snapshot.stocks) {
      const sources = snapshot.evidence.filter(item => (!item.stockCode || item.stockCode === stock.code) && (item.status === 'available' || item.status === 'partial'))
        .map(({ id, title, source, asOf, retrievedAt }) => ({ id, title, source, asOf, retrievedAt }));
      if (!sources.length) continue;
      const saved = await addMemory({ kind: 'research', text: answer.slice(0, 1800), code: stock.code,
        sourceEvidenceIds: sources.map(item => item.id), provenance: { sessionId, snapshotAt: snapshot.generatedAt, sources },
      });
      first ??= saved;
    }
    return first;
  }
  const sources = snapshot.evidence.filter(item => item.status === 'available' || item.status === 'partial')
    .map(({ id, title, source, asOf, retrievedAt }) => ({ id, title, source, asOf, retrievedAt }));
  if (!snapshot.code || !sources.length) return null;
  return addMemory({ kind: 'research', text: answer.slice(0, 1800), code: snapshot.code,
    sourceEvidenceIds: sources.map(item => item.id), provenance: { sessionId, snapshotAt: snapshot.generatedAt, sources },
  });
}
