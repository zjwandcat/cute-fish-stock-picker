import type { AgentPhase, ResearchMode } from './agentCatalog.js';
import type { EvidenceRecord, FinanceSnapshot } from './types.js';

export type AgentStatus = 'queued' | 'running' | 'completed' | 'skipped' | 'failed' | 'cancelled';
export type ResearchStatus = 'collecting' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentRuntime = 'deepseek-harness' | 'fallback';

export interface ResearchStock { code: string; name: string }
export type ResearchQuestionType = 'single_stock' | 'comparison' | 'industry' | 'market' | 'portfolio' | 'other';
export type ResearchFocus = 'price' | 'technical' | 'valuation' | 'financials' | 'dividend' | 'ownership_flow' | 'cross_market' | 'macro' | 'news' | 'risk' | 'industry' | 'portfolio' | 'comparison';

export interface ResearchPlan {
  stocks: ResearchStock[];
  questionType: ResearchQuestionType;
  focusAreas: ResearchFocus[];
  agentIds: string[];
  summary: string;
  confidence: number;
  researchQuestions?: string[];
  timeHorizon?: string;
}

export interface ToolActivity {
  id: string;
  name: string;
  arguments: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  summary?: string;
  evidenceIds?: string[];
}

export type AgentActivity =
  | { type: 'phase'; phase: 'thinking' | 'answering' | 'tool' }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; tool: ToolActivity };

export interface AgentReport {
  id: string;
  name: string;
  desk: string;
  phase: AgentPhase;
  status: AgentStatus;
  answer?: string;
  reason?: string;
  runtime?: AgentRuntime;
  evidenceIds: string[];
  startedAt?: string;
  completedAt?: string;
  activity?: 'thinking' | 'answering' | 'tool';
  reasoning?: string;
  reasoningTruncated?: boolean;
  toolCalls?: ToolActivity[];
  debateRounds?: { round: number; answer: string; evidenceIds: string[] }[];
}

export interface ResearchProgress {
  sessionId: string;
  runId: string;
  mode: ResearchMode;
  status: ResearchStatus;
  stage: string;
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  running: number;
  agentReports: AgentReport[];
  startedAt: string;
  completedAt?: string;
  error?: string;
  researchPlan?: ResearchPlan;
}

export interface ResearchResult {
  answer: string;
  runtime: AgentRuntime | 'mixed';
  evidence: EvidenceRecord[];
  sessionId: string;
  runId: string;
  mode: ResearchMode;
  status: 'completed';
  stages: string[];
  agentReports: AgentReport[];
  remembered: boolean;
  generatedAt: string;
  researchPlan: ResearchPlan;
}

export interface ResearchConversationTurn {
  question: string;
  answer: string;
  code: string | null;
  stocks?: ResearchStock[];
  createdAt: string;
}

export interface CompletedResearch {
  result: ResearchResult;
  snapshot: FinanceSnapshot;
}
