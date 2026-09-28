import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { FINANCE_AGENTS, selectRoutedAgents, type ResearchMode } from '../services/ai/agentCatalog.js';
import { getAiConfig, saveAiConfig, toAiConfigView } from '../services/ai/config.js';
import { addMemory, deleteMemory, listMemory, saveResearchMemory } from '../services/ai/memory.js';
import { MAX_AGENT_CONCURRENCY } from '../services/ai/orchestrator.js';
import { getCompletedResearch, getResearchProgress, markResearchRemembered, ResearchRequestError, startResearch, stopResearch } from '../services/ai/runManager.js';

const router = Router();
const MODES: ResearchMode[] = ['quick', 'standard', 'deep'];

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validSessionId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

router.use('/ai', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.get('/ai/config', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ success: true, data: toAiConfigView(await getAiConfig()) });
  } catch {
    res.status(500).json({ success: false, error: '读取 AI 配置失败。' });
  }
});

router.put('/ai/config', async (req: Request, res: Response): Promise<void> => {
  try {
    const config = await saveAiConfig(req.body);
    res.json({ success: true, data: toAiConfigView(config) });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'AI 配置无效。' });
  }
});

router.get('/ai/capabilities', async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await getAiConfig();
    res.json({ success: true, data: {
      markets: ['A', 'HK'],
      evidence: ['实时行情', '历史日线', '估值指标', 'TET', 'MACD-V', '资金流与股东', 'A/H 比价', '拥挤度'],
      runtimes: ['deepseek-harness', 'fallback'],
      harnessVersion: toAiConfigView(config).harnessVersion,
      tushareMcpConfigured: toAiConfigView(config).tushareMcpConfigured,
      memory: ['preference', 'watchlist', 'research'],
      agentCount: FINANCE_AGENTS.length,
      maxConcurrency: MAX_AGENT_CONCURRENCY,
      modes: MODES.map((mode) => ({ mode, agentCount: selectRoutedAgents(mode, FINANCE_AGENTS.map(agent => agent.id), 'single_stock').length })),
      agents: FINANCE_AGENTS.map(({ id, name, desk, phase, evidenceIds }) => ({ id, name, desk, phase, evidenceIds })),
    } });
  } catch {
    res.status(500).json({ success: false, error: '读取 AI 能力失败。' });
  }
});

router.post('/ai/research', async (req: Request, res: Response): Promise<void> => {
  const question = stringValue(req.body?.question);
  const rawCode = stringValue(req.body?.code);
  const sessionId = stringValue(req.body?.sessionId) || `research_${randomUUID()}`;
  const context = stringValue(req.body?.context);
  const mode = (req.body?.mode ?? 'deep') as ResearchMode;
  if (question.length < 2 || question.length > 4000) {
    res.status(400).json({ success: false, error: '问题长度需要在 2 到 4000 个字符之间。' });
    return;
  }
  if (!validSessionId(sessionId) || !MODES.includes(mode) || rawCode.length > 80 || context.length > 2000) {
    res.status(400).json({ success: false, error: '会话、研究模式、标的或上下文不符合要求。' });
    return;
  }
  try {
    const config = await getAiConfig();
    if (!config.enabled || !config.apiKey) {
      res.status(503).json({ success: false, error: '请先在 AI 设置中启用模型并配置 API Key。' });
      return;
    }
    const result = await startResearch({
      sessionId, mode, code: rawCode || undefined, question: context ? `${question}\n当前界面上下文：${context}` : question,
      config,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    const status = error instanceof ResearchRequestError ? error.status : 502;
    res.status(status).json({ success: false, error: error instanceof ResearchRequestError ? error.message : '研究请求失败，请检查模型服务与数据源配置。', sessionId });
  }
});

router.get('/ai/research/:sessionId/status', (req: Request, res: Response): void => {
  const sessionId = req.params.sessionId;
  if (!validSessionId(sessionId)) {
    res.status(400).json({ success: false, error: '研究会话 ID 无效。' });
    return;
  }
  const progress = getResearchProgress(sessionId);
  if (!progress) {
    res.status(404).json({ success: false, error: '研究会话不存在或已过期。' });
    return;
  }
  res.json({ success: true, data: progress });
});

router.post('/ai/stop', (req: Request, res: Response): void => {
  const sessionId = stringValue(req.body?.sessionId);
  if (!validSessionId(sessionId)) {
    res.status(400).json({ success: false, error: '研究会话 ID 无效。' });
    return;
  }
  res.json({ success: true, stopped: stopResearch(sessionId) });
});

router.post('/ai/research/:sessionId/memory', async (req: Request, res: Response): Promise<void> => {
  try {
    const runId = stringValue(req.body?.runId);
    const completed = getCompletedResearch(req.params.sessionId, runId);
    if (!completed) {
      res.status(404).json({ success: false, error: '该次研究不存在或已过期，请重新研究后保存。' });
      return;
    }
    if (!(await getAiConfig()).memoryEnabled) {
      res.status(409).json({ success: false, error: '请先启用长期记忆。' });
      return;
    }
    const memory = await saveResearchMemory(runId, completed.result.answer, completed.snapshot);
    if (!memory) {
      res.status(400).json({ success: false, error: '本次研究缺少可追溯的标的证据，不能保存为长期研究记忆。' });
      return;
    }
    markResearchRemembered(req.params.sessionId, runId);
    res.json({ success: true, data: memory });
  } catch {
    res.status(500).json({ success: false, error: '保存研究记忆失败。' });
  }
});

router.get('/ai/memory', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ success: true, data: await listMemory() });
  } catch {
    res.status(500).json({ success: false, error: '读取长期记忆失败。' });
  }
});

router.post('/ai/memory', async (req: Request, res: Response): Promise<void> => {
  try {
    const kind = req.body?.kind;
    const text = stringValue(req.body?.text);
    if (kind !== 'preference' && kind !== 'watchlist') {
      res.status(400).json({ success: false, error: '此接口只能显式保存偏好或自选关注。' });
      return;
    }
    const item = await addMemory({ kind, text, code: stringValue(req.body?.code) || undefined });
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : '记忆内容无效。' });
  }
});

router.delete('/ai/memory/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    res.json({ success: true, deleted: await deleteMemory(req.params.id) });
  } catch {
    res.status(500).json({ success: false, error: '删除记忆失败。' });
  }
});

export default router;
