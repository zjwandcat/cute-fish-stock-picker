import { randomUUID } from 'node:crypto';
import { appendMcpEvidence, getTushareMcpUrl } from './tushareMcp.js';
import { selectRoutedAgents, type ResearchMode } from './agentCatalog.js';
import { buildFinanceSnapshot } from './financeGateway.js';
import { runOrchestration, safeFailureReason } from './orchestrator.js';
import { planResearch, isResearchClarification } from './researchPlanner.js';
import { retrieveMemory } from './memory.js';
import type { AgentReport, CompletedResearch, ResearchConversationTurn, ResearchPlan, ResearchProgress, ResearchResult } from './researchTypes.js';
import type { AiConfig, FinanceSnapshot } from './types.js';

interface ManagedRun {
  progress: ResearchProgress;
  controller: AbortController;
  completed?: CompletedResearch;
  history: ResearchConversationTurn[];
}

interface ResearchInput {
  sessionId: string;
  mode: ResearchMode;
  question: string;
  code?: string;
  config: AiConfig;
}

const runs = new Map<string, ManagedRun>();
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const MAX_RETAINED_SESSIONS = 40;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_RESEARCH = 1;

export class ResearchRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function combineFinanceSnapshots(snapshots: FinanceSnapshot[]): FinanceSnapshot {
  if (!snapshots.length) return { code: null, name: null, market: 'unknown', stocks: [], generatedAt: new Date().toISOString(), evidence: [] };
  if (snapshots.length === 1) {
    const snapshot = snapshots[0];
    snapshot.stocks = snapshot.code ? [{ code: snapshot.code, name: snapshot.name ?? snapshot.code, market: snapshot.market === 'HK' ? 'HK' : 'A' }] : [];
    return snapshot;
  }
  const stocks = snapshots.flatMap(snapshot => snapshot.code ? [{ code: snapshot.code, name: snapshot.name ?? snapshot.code, market: snapshot.market === 'HK' ? 'HK' as const : 'A' as const }] : []);
  let evidenceIndex = 0;
  const evidence = snapshots.flatMap(snapshot => snapshot.evidence.map(item => ({
    ...item, id: `E${++evidenceIndex}`, sourceEvidenceId: item.id,
    stockCode: snapshot.code ?? undefined, stockName: snapshot.name ?? snapshot.code ?? undefined,
    stockMarket: snapshot.market === 'HK' ? 'HK' as const : 'A' as const,
    title: `${snapshot.name ?? snapshot.code} · ${item.title}`,
  })));
  return { code: null, name: null, market: 'unknown', stocks, generatedAt: new Date().toISOString(), evidence };
}

function researchPlanAgents(plan: ResearchPlan, mode: ResearchMode): AgentReport[] {
  return selectRoutedAgents(mode, plan.agentIds, plan.questionType).map(agent => ({
    id: agent.id, name: agent.name, desk: agent.desk, phase: agent.phase, status: 'queued', evidenceIds: [],
  }));
}

function trimSessions(): void {
  const sorted = [...runs.entries()].filter(([, run]) => TERMINAL_STATES.has(run.progress.status))
    .sort(([, a], [, b]) => a.progress.startedAt.localeCompare(b.progress.startedAt));
  for (const [sessionId, run] of sorted) {
    if (runs.size < MAX_RETAINED_SESSIONS && Date.now() - Date.parse(run.progress.startedAt) <= SESSION_TTL_MS) break;
    runs.delete(sessionId);
  }
}

function updateReports(run: ManagedRun, reports: AgentReport[], stage: string): void {
  run.progress.agentReports = reports;
  run.progress.stage = stage;
  run.progress.total = reports.length;
  run.progress.completed = reports.filter((report) => report.status === 'completed').length;
  run.progress.skipped = reports.filter((report) => report.status === 'skipped').length;
  run.progress.failed = reports.filter((report) => report.status === 'failed').length;
  run.progress.running = reports.filter((report) => report.status === 'running').length;
}

/** Stops waiting promptly even when an existing market-data adapter cannot accept a signal. */
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error('研究已停止。');
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('研究已停止。'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function getResearchProgress(sessionId: string): ResearchProgress | undefined {
  trimSessions();
  const progress = runs.get(sessionId)?.progress;
  return progress ? structuredClone(progress) : undefined;
}

export function getCompletedResearch(sessionId: string, runId: string): CompletedResearch | undefined {
  const run = runs.get(sessionId);
  return run?.progress.runId === runId && run.progress.status === 'completed' && run.completed
    ? structuredClone(run.completed) : undefined;
}

export function markResearchRemembered(sessionId: string, runId: string): void {
  const run = runs.get(sessionId);
  if (run?.completed && run.progress.runId === runId) run.completed.result.remembered = true;
}

export function stopResearch(sessionId: string): boolean {
  const run = runs.get(sessionId);
  if (!run || TERMINAL_STATES.has(run.progress.status)) return false;
  run.controller.abort(new Error('研究已停止。'));
  return true;
}

function cancelledReports(reports: AgentReport[]): AgentReport[] {
  return reports.map((report) => report.status === 'queued' || report.status === 'running'
    ? { ...report, status: 'cancelled', reason: '研究已停止。', completedAt: new Date().toISOString() } : report);
}

export async function startResearch(input: ResearchInput, dependencies: {
  planner?: typeof planResearch;
  buildSnapshot?: typeof buildFinanceSnapshot;
  appendEvidence?: typeof appendMcpEvidence;
  mcpUrl?: typeof getTushareMcpUrl;
  orchestrate?: typeof runOrchestration;
  memory?: typeof retrieveMemory;
} = {}): Promise<ResearchResult> {
  trimSessions();
  const previous = runs.get(input.sessionId);
  if (previous && !TERMINAL_STATES.has(previous.progress.status)) throw new ResearchRequestError('该研究会话正在运行。', 409);
  if ([...runs.values()].filter((run) => !TERMINAL_STATES.has(run.progress.status)).length >= MAX_ACTIVE_RESEARCH) {
    throw new ResearchRequestError('已有研究任务运行中，请等待完成或先停止。', 429);
  }
  const controller = new AbortController();
  const run: ManagedRun = {
    controller,
    history: previous?.history ?? [],
    progress: {
      sessionId: input.sessionId, runId: randomUUID(), mode: input.mode, status: 'collecting', stage: '识别股票与研究问题',
      total: 0, completed: 0, skipped: 0, failed: 0, running: 0, agentReports: [], startedAt: new Date().toISOString(),
    },
  };
  runs.set(input.sessionId, run);
  const limits: Record<ResearchMode, number> = { quick: 10 * 60_000, standard: 25 * 60_000, deep: 50 * 60_000 };
  const timer = setTimeout(() => controller.abort(new Error('研究超过本次时间上限。')), limits[input.mode]);
  timer.unref();
  try {
    const plan = await abortable((dependencies.planner ?? planResearch)({
      question: input.question, code: input.code, mode: input.mode, sessionId: run.progress.runId,
      config: input.config, signal: controller.signal, history: run.history,
    }), controller.signal);
    run.progress.researchPlan = plan;
    updateReports(run, researchPlanAgents(plan, input.mode), '获取已识别标的的市场证据');
    const individual: FinanceSnapshot[] = [];
    for (const [index, stock] of plan.stocks.entries()) {
      controller.signal.throwIfAborted();
      run.progress.stage = `读取标的证据 ${index + 1}/${plan.stocks.length} · ${stock.name}`;
      const { snapshot } = await abortable((dependencies.buildSnapshot ?? buildFinanceSnapshot)(stock.code), controller.signal);
      controller.signal.throwIfAborted();
      snapshot.name ||= stock.name;
      const mcpUrl = (dependencies.mcpUrl ?? getTushareMcpUrl)();
      if (mcpUrl) await abortable((dependencies.appendEvidence ?? appendMcpEvidence)(snapshot, mcpUrl, controller.signal), controller.signal);
      individual.push(snapshot);
    }
    const snapshot = combineFinanceSnapshots(individual);
    const memoryLists = input.config.memoryEnabled
      ? await abortable(Promise.all(plan.stocks.map(stock => (dependencies.memory ?? retrieveMemory)(stock.code))), controller.signal)
      : [];
    const memories = [...new Set(memoryLists.flat())].slice(0, 24);
    const codes = new Set(plan.stocks.map(stock => stock.code));
    const history = run.history.filter((turn) => turn.stocks?.some(stock => codes.has(stock.code)) || (turn.code && codes.has(turn.code))).slice(-3);
    run.progress.status = 'running';
    const output = await (dependencies.orchestrate ?? runOrchestration)({
      sessionId: run.progress.runId, config: input.config, mode: input.mode, question: input.question, researchPlan: plan,
      snapshot, memories, history, signal: controller.signal,
      onProgress: (reports, stage) => updateReports(run, reports, stage),
    });
    const result: ResearchResult = {
      ...output, evidence: snapshot.evidence, sessionId: input.sessionId, runId: run.progress.runId,
      mode: input.mode, status: 'completed', remembered: false, generatedAt: snapshot.generatedAt,
    };
    run.completed = { result, snapshot: structuredClone(snapshot) as FinanceSnapshot };
    run.progress.status = 'completed';
    run.progress.stage = '研究完成';
    run.history = [...run.history, { question: input.question.slice(0, 2000), answer: result.answer.slice(0, 4000), code: snapshot.code, stocks: plan.stocks, createdAt: new Date().toISOString() }].slice(-6);
    return result;
  } catch (_error) {
    if (controller.signal.aborted) {
      run.progress.status = 'cancelled';
      run.progress.stage = '研究已停止';
      run.progress.error = '研究已停止或达到本次时间上限。';
      updateReports(run, cancelledReports(run.progress.agentReports), run.progress.stage);
      throw new ResearchRequestError(run.progress.error, 409);
    }
    if (isResearchClarification(_error)) {
      run.progress.status = 'failed';
      run.progress.stage = '需要补充信息';
      run.progress.error = _error.message;
      run.history = [...run.history, { question: input.question.slice(0, 2000), answer: '', code: null, createdAt: new Date().toISOString() }].slice(-6);
      throw new ResearchRequestError(_error.message, 422);
    }
    if (run.progress.stage === '识别股票与研究问题') {
      const message = _error instanceof Error ? _error.message : '';
      run.progress.status = 'failed';
      run.progress.stage = '问题识别未完成';
      run.progress.error = message.startsWith('研究计划') || message.startsWith('AI 未选出')
        ? message : `问题识别失败：${safeFailureReason(_error)}`;
      throw new ResearchRequestError(run.progress.error, 502);
    }
    const cancelled = controller.signal.aborted;
    const failedStage = run.progress.stage;
    run.progress.status = cancelled ? 'cancelled' : 'failed';
    run.progress.stage = cancelled ? '研究已停止' : '研究未完成';
    if (cancelled) {
      run.progress.error = '研究已停止或达到本次时间上限。';
    } else {
      const failed = run.progress.agentReports.filter(report => report.status === 'failed');
      const detail = failed.slice(0, 3).map(report => `${report.name}：${report.reason}`).join('；');
      run.progress.error = detail
        ? `研究未完成。${detail}${failed.length > 3 ? `；另有 ${failed.length - 3} 个角色失败。` : ''}`
        : `研究未完成：${failedStage}阶段没有生成最终答复，请查看“团队”中的角色状态。`;
    }
    if (cancelled) updateReports(run, cancelledReports(run.progress.agentReports), run.progress.stage);
    throw new ResearchRequestError(run.progress.error, cancelled ? 409 : 502);
  } finally {
    clearTimeout(timer);
    run.progress.completedAt = new Date().toISOString();
  }
}
