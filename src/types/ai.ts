import type { AgentReport } from '../../api/services/ai/researchTypes';
export type { ResearchMode } from '../../api/services/ai/agentCatalog';
export type { ResearchProgress, ResearchResult } from '../../api/services/ai/researchTypes';
export type { ResearchPlan } from '../../api/services/ai/researchTypes';

export interface AiConfigView {
  baseUrl: string;
  model: string;
  enabled: boolean;
  protocol: 'deepseek' | 'openai-compatible';
  apiKeyConfigured: boolean;
  tushareMcpConfigured: boolean;
  memoryEnabled: boolean;
  harnessVersion: string;
  thinkingEnabled: boolean;
  reasoningEffort: 'auto' | 'low' | 'high' | 'max';
}

export interface AiEvidence {
  id: string;
  title: string;
  source: string;
  status: 'available' | 'partial' | 'empty' | 'unavailable' | 'error';
  valueKind: 'reported' | 'calculated' | 'estimated' | 'context';
  asOf: string | null;
  retrievedAt: string;
  note?: string;
  data?: unknown;
  sourceEvidenceId?: string;
  stockCode?: string;
  stockName?: string;
  stockMarket?: 'A' | 'HK';
}

export type ResearchAgent = Omit<AgentReport, 'status'> & { status?: AgentReport['status'] };

export interface AiMemory {
  id: string;
  kind: 'preference' | 'watchlist' | 'research';
  text: string;
  code?: string;
  sourceEvidenceIds?: string[];
  createdAt: string;
  expiresAt?: string;
}
