import type { EvidenceRecord, FinanceSnapshot } from './types.js';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ResearchTool {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, JsonValue>; required: string[]; additionalProperties: false };
}

export interface ResearchToolResult {
  content: string;
  summary: string;
  evidenceIds: string[];
  isError?: boolean;
}

export interface ResearchTools {
  definitions: ResearchTool[];
  execute(name: string, args: unknown, signal: AbortSignal): Promise<ResearchToolResult>;
}

const STATEMENTS = { income: 'E10', balancesheet: 'E11', cashflow: 'E12', dividend: 'E17' } as const;

function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 10).map(compact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined).map(([key, item]) => [key, compact(item)]));
  return value;
}

/** Tools see only the current role's immutable snapshot, never account secrets. */
export function createResearchTools(snapshot: FinanceSnapshot, allowedIds?: string[]): ResearchTools {
  const evidence = structuredClone(snapshot.evidence.filter(item => allowedIds === undefined || allowedIds.includes(item.id)));
  const statementIds = new Set<string>(Object.values(STATEMENTS));
  const marketIds = evidence.filter(item => !statementIds.has(item.sourceEvidenceId ?? item.id)).map(item => item.id);
  const statements = Object.entries(STATEMENTS).filter(([, id]) => evidence.some(item => (item.sourceEvidenceId ?? item.id) === id)).map(([name]) => name);
  const definitions: ResearchTool[] = [];
  if (marketIds.length) definitions.push({ name: 'read_market_evidence', description: '读取本次标的的行情、估值、趋势、资金流或数据缺口。数据来自本次统一快照，返回来源、日期、证据编号及原始数值。', parameters: {
    type: 'object', properties: { evidence_ids: { type: 'array', items: { type: 'string', enum: marketIds }, minItems: 1, maxItems: 8 } }, required: ['evidence_ids'], additionalProperties: false,
  } });
  if (statements.length) definitions.push({ name: 'read_financial_statements', description: '读取本次标的经 Tushare MCP 获取的财务报表或分红记录；保留报告期与币种口径，缺失值不代表零。', parameters: {
    type: 'object', properties: { statement: { type: 'string', enum: statements } }, required: ['statement'], additionalProperties: false,
  } });
  const invalid = (): ResearchToolResult => ({ isError: true, content: JSON.stringify({ error: '工具或参数无效，仅能读取当前角色、本次标的允许的证据。' }), summary: '参数校验失败，未读取数据', evidenceIds: [] });
  return { definitions, async execute(name, args, signal) {
    signal.throwIfAborted();
    if (!args || typeof args !== 'object' || Array.isArray(args)) return invalid();
    const fields = args as Record<string, unknown>;
    let selected: EvidenceRecord[];
    if (name === 'read_market_evidence' && Object.keys(fields).length === 1 && Array.isArray(fields.evidence_ids)
      && fields.evidence_ids.length > 0 && fields.evidence_ids.length <= 8 && fields.evidence_ids.every(id => typeof id === 'string' && marketIds.includes(id))) {
      selected = evidence.filter(item => (fields.evidence_ids as string[]).includes(item.id));
    } else if (name === 'read_financial_statements' && Object.keys(fields).length === 1 && typeof fields.statement === 'string' && statements.includes(fields.statement)) {
      selected = evidence.filter(item => (item.sourceEvidenceId ?? item.id) === STATEMENTS[fields.statement as keyof typeof STATEMENTS]);
    } else return invalid();
    const usable = selected.filter(item => item.status === 'available' || item.status === 'partial');
    return {
      content: JSON.stringify({ stocks: snapshot.stocks, code: snapshot.code, name: snapshot.name, generatedAt: snapshot.generatedAt, evidence: selected.map(item => ({ ...item, data: compact(item.data) })) }),
      summary: `${selected.map(item => item.title).join('、')}：${usable.length}/${selected.length} 项可用；共享本次数据快照`,
      evidenceIds: usable.map(item => item.id),
    };
  } };
}
