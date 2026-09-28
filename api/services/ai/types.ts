export type AiProtocol = 'deepseek' | 'openai-compatible';
export type ReasoningEffort = 'auto' | 'low' | 'high' | 'max';

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  protocol: AiProtocol;
  memoryEnabled: boolean;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
}

export interface AiConfigView {
  baseUrl: string;
  model: string;
  enabled: boolean;
  protocol: AiProtocol;
  apiKeyConfigured: boolean;
  tushareMcpConfigured: boolean;
  memoryEnabled: boolean;
  harnessVersion: string;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
}

export type EvidenceStatus = 'available' | 'partial' | 'empty' | 'unavailable' | 'error';
export type EvidenceValueKind = 'reported' | 'calculated' | 'estimated' | 'context';

export interface EvidenceRecord {
  id: string;
  title: string;
  source: string;
  status: EvidenceStatus;
  valueKind: EvidenceValueKind;
  asOf: string | null;
  retrievedAt: string;
  note?: string;
  data?: unknown;
  sourceEvidenceId?: string;
  stockCode?: string;
  stockName?: string;
  stockMarket?: 'A' | 'HK';
}

export interface FinanceSnapshot {
  code: string | null;
  name: string | null;
  market: 'A' | 'HK' | 'unknown';
  stocks?: { code: string; name: string; market: 'A' | 'HK' }[];
  generatedAt: string;
  evidence: EvidenceRecord[];
}
