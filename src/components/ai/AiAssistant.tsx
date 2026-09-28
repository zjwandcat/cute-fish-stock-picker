import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowUp, Bookmark, Bot, ChevronDown, Clipboard, FileCheck2, LoaderCircle, Plus, Settings2, Square, X } from 'lucide-react';
import { aiRequest } from '@/services/ai';
import { useAiStore } from '@/store/aiStore';
import { useStockStore } from '@/store/stockStore';
import { useUIStore } from '@/store/uiStore';
import type { AiEvidence, ResearchAgent, ResearchMode, ResearchPlan, ResearchProgress, ResearchResult } from '@/types/ai';
import AiSettingsDialog from './AiSettingsDialog';
import AiMemoryPanel from './AiMemoryPanel';
import AiAgentPanel from './AiAgentPanel';
import './ai.css';

interface Turn {
  id: string;
  question: string;
  code: string;
  mode: ResearchMode;
  result?: ResearchResult;
  error?: string;
  trace?: ResearchAgent[];
  plan?: ResearchPlan;
}

const modeNames: Record<ResearchMode, string> = { quick: '快速', standard: '标准', deep: '专家会诊' };
const evidenceStates = { available: '可用', partial: '部分可用', empty: '无数据', unavailable: '不可用', error: '获取失败' };
const valueKinds = { reported: '来源数据', calculated: '计算指标', estimated: '估算数据', context: '上下文' };
const focusNames: Record<string, string> = { price: '行情', technical: '技术', valuation: '估值', financials: '财务', dividend: '分红', ownership_flow: '股东与资金', cross_market: '跨市场', macro: '宏观', news: '新闻公告', risk: '风险', industry: '行业', portfolio: '组合', comparison: '对比' };

function ResearchPlanView({ plan }: { plan?: ResearchPlan }) {
  if (!plan) return null;
  return <div className="ai-research-plan">
    <div><span className="ai-muted">识别股票</span><strong>{plan.stocks.map(stock => `${stock.name} ${stock.code}`).join(' · ') || '未指定单一股票'}</strong></div>
    <p>{plan.summary}</p>
    {!!plan.researchQuestions?.length && <ul className="ai-plan-questions">{plan.researchQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul>}
    {plan.timeHorizon && plan.timeHorizon !== '用户未指定' && <p className="ai-muted">时间范围：{plan.timeHorizon}</p>}
    <div className="ai-plan-footer"><span>{plan.agentIds.length} 位专业分析师 + 交叉审查与汇总</span><span>{plan.focusAreas.map(area => focusNames[area] || area).join(' · ')}</span></div>
  </div>;
}
function Answer({ text, prefix }: { text: string; prefix: string }) {
  return <div className="ai-answer">{text.split(/(\[E\d+\])/g).map((part, index) => /^\[E\d+\]$/.test(part)
    ? <a key={index} href={`#${prefix}-${part.slice(1, -1)}`} onClick={() => {
      const evidence = document.getElementById(`${prefix}-${part.slice(1, -1)}`) as HTMLDetailsElement | null;
      if (evidence) evidence.open = true;
    }}>{part}</a>
    : <Fragment key={index}>{part}</Fragment>)}</div>;
}

function Evidence({ items, prefix }: { items: AiEvidence[]; prefix: string }) {
  return (
    <div className="ai-evidence">
      <div className="ai-section-heading"><h4>研究证据</h4><span className="ai-muted">{items.length} 项</span></div>
      {items.map((item) => (
        <details key={item.id} id={`${prefix}-${item.id}`}>
          <summary><span className="ai-evidence-id">{item.id}</span><span>{item.title}</span><small className={item.status === 'available' ? 'ai-good' : 'ai-muted'}>{evidenceStates[item.status]}</small><ChevronDown size={13} /></summary>
          <div className="ai-evidence-content"><p>{item.source} · {valueKinds[item.valueKind]}</p><p className="ai-muted">数据截至 {item.asOf || '未提供'} · 获取于 {new Date(item.retrievedAt).toLocaleString('zh-CN')}</p>{item.note && <p>{item.note}</p>}{item.data !== undefined && <pre>{JSON.stringify(item.data, null, 2)}</pre>}</div>
        </details>
      ))}
    </div>
  );
}

export default function AiAssistant() {
  const { config, panelOpen, settingsOpen, contextCode, loadConfig, setPanelOpen, setSettingsOpen, setContextCode } = useAiStore();
  const theme = useUIStore((state) => state.theme);
  const selectedStock = useStockStore((state) => state.selectedStock);
  const [tab, setTab] = useState<'research' | 'agents' | 'memory'>('research');
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<ResearchMode>('deep');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ResearchProgress | null>(null);
  const [catalog, setCatalog] = useState<ResearchAgent[]>([]);
  const [stopPending, setStopPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [memoryRefresh, setMemoryRefresh] = useState(0);
  const [rememberPending, setRememberPending] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController | null>(null);
  const currentRun = useRef<string | null>(null);
  const session = useRef(`research_${crypto.randomUUID()}`);
  const end = useRef<HTMLDivElement>(null);
  const ready = Boolean(config?.enabled && config.apiKeyConfigured);

  useEffect(() => {
    void loadConfig();
    void aiRequest<{ agents?: ResearchAgent[] }>('/capabilities').then((data) => setCatalog(data.agents || [])).catch(() => undefined);
  }, [loadConfig]);

  useEffect(() => {
    if (selectedStock) setPanelOpen(false);
  }, [selectedStock, setPanelOpen]);

  useEffect(() => {
    if (panelOpen && tab === 'research') input.current?.focus();
  }, [panelOpen, tab]);

  useEffect(() => {
    if (tab === 'research') end.current?.scrollIntoView({ block: 'nearest' });
  }, [turns.length, tab]);

  useEffect(() => {
    if (!runId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await aiRequest<ResearchProgress>(`/research/${encodeURIComponent(runId)}/status`);
        if (active) {
          setProgress(data);
          if (data.researchPlan) setTurns(previous => previous.map(turn => turn.id === previous.at(-1)?.id ? { ...turn, plan: data.researchPlan } : turn));
        }
      } catch {
        // The POST can still be registering the job when the first poll arrives.
      }
      if (active) timer = setTimeout(() => { void poll(); }, 1200);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [runId]);

  function launch() {
    if (selectedStock) {
      setContextCode(selectedStock);
      useStockStore.getState().closeStock();
    }
    setPanelOpen(true);
  }

  async function submit() {
    if (!question.trim() || runId || !ready) return;
    const id = `research_${crypto.randomUUID()}`;
    const requestQuestion = question.trim();
    const code = contextCode.trim();
    const abort = new AbortController();
    controller.current = abort;
    currentRun.current = id;
    setRunId(session.current);
    setProgress(null);
    setNotice('');
    setQuestion('');
    setTab('research');
    setTurns((previous) => [...previous, { id, question: requestQuestion, code, mode }]);
    try {
      const result = await aiRequest<ResearchResult>('/research', {
        method: 'POST',
        body: JSON.stringify({ question: requestQuestion, code: code || undefined, sessionId: session.current, mode }),
        signal: abort.signal,
      });
      if (currentRun.current !== id) return;
      setTurns((previous) => previous.map((turn) => turn.id === id ? { ...turn, result, plan: result.researchPlan } : turn));
      if (result.agentReports) setProgress((previous) => ({
        sessionId: result.sessionId, runId: result.runId, status: result.status, stage: '研究完成', mode, agentReports: result.agentReports, researchPlan: result.researchPlan,
        total: result.agentReports.length,
        completed: result.agentReports.filter((agent) => agent.status === 'completed').length,
        skipped: result.agentReports.filter((agent) => agent.status === 'skipped').length,
        failed: result.agentReports.filter((agent) => agent.status === 'failed').length,
        running: 0,
        startedAt: previous?.startedAt || new Date().toISOString(), completedAt: new Date().toISOString(),
      }));
      if (result.remembered) setMemoryRefresh((value) => value + 1);
    } catch (error) {
      if (currentRun.current !== id) return;
      setTurns((previous) => previous.map((turn) => turn.id === id ? { ...turn, error: abort.signal.aborted ? '研究已停止。' : (error as Error).message } : turn));
      try {
        const failedProgress = await aiRequest<ResearchProgress>(`/research/${encodeURIComponent(session.current)}/status`);
        if (currentRun.current === id) {
          setProgress(failedProgress);
          setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, trace: failedProgress.agentReports, plan: failedProgress.researchPlan } : turn));
        }
      } catch { /* The request may fail before a research run is registered. */ }
    } finally {
      if (currentRun.current === id) {
        currentRun.current = null;
        controller.current = null;
        setRunId(null);
        setStopPending(false);
      }
    }
  }

  async function stop() {
    if (!runId || stopPending) return;
    setStopPending(true);
    try {
      await aiRequest('/stop', { method: 'POST', body: JSON.stringify({ sessionId: runId }) });
      controller.current?.abort();
      setProgress((previous) => previous ? { ...previous, status: 'cancelled', agentReports: previous.agentReports.map((agent) => agent.status === 'running' || agent.status === 'queued' ? { ...agent, status: 'cancelled' } : agent) } : previous);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setStopPending(false);
    }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice('已复制研究结论。'); } catch { setNotice('无法访问剪贴板。'); }
  }

  async function remember(turn: Turn) {
    if (!turn.result || rememberPending) return;
    setRememberPending(turn.id);
    try {
      await aiRequest(`/research/${encodeURIComponent(turn.result.sessionId)}/memory`, { method: 'POST', body: JSON.stringify({ runId: turn.result.runId }) });
      setTurns((previous) => previous.map((item) => item.id === turn.id && item.result ? { ...item, result: { ...item.result, remembered: true } } : item));
      setMemoryRefresh((value) => value + 1);
      setNotice('已保存本次研究记忆。');
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setRememberPending(null);
    }
  }

  const agents = progress?.agentReports || catalog;
  const finished = progress ? progress.completed + progress.skipped + progress.failed : 0;

  return (
    <div className={`ai-root ${theme === 'dark' ? 'ai-dark' : ''}`}>
      {ready && !panelOpen && <button className="ai-launcher" title="打开 AI 研究助手" aria-label="打开 AI 研究助手" onClick={launch}><Bot size={25} />{runId && <span className="ai-launcher-running" />}</button>}
      {panelOpen && <aside className="ai-panel" aria-label="AI 研究助手">
        <header className="ai-header">
          <div className="ai-title"><Bot size={21} /><div><h2>AI 研究助手</h2><span className="ai-muted">A 股与港股{config?.model ? ` · ${config.model}` : ''}</span></div></div>
          <div className="ai-toolbar"><button className="ai-icon" title="新研究" aria-label="新研究" disabled={Boolean(runId)} onClick={() => { session.current = `research_${crypto.randomUUID()}`; setTurns([]); setProgress(null); setNotice(''); setTab('research'); }}><Plus size={19} /></button><button className="ai-icon" title="AI 设置" aria-label="AI 设置" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /></button><button className="ai-icon" title="收起助手" aria-label="收起助手" onClick={() => setPanelOpen(false)}><X size={19} /></button></div>
        </header>
        <div className="ai-tabs" role="tablist" aria-label="助手视图">{(['research', 'agents', 'memory'] as const).map((value) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{value === 'research' ? '研究' : value === 'agents' ? `团队${agents.length ? ` ${agents.length}` : ''}` : '记忆'}</button>)}</div>
        {runId && <div className="ai-progress" role="status"><div><LoaderCircle size={14} className="animate-spin" /><span>{progress?.stage || '正在识别股票和研究重点'}</span><span>{progress ? `${finished}/${progress.total}` : ''}</span></div>{progress?.researchPlan && <div className="ai-progress-plan"><span>{progress.researchPlan.stocks.map(stock => stock.name).join('、')}</span><span>{progress.researchPlan.agentIds.length} 位专家 · {progress.researchPlan.summary}</span></div>}{progress && <progress value={finished} max={Math.max(progress.total, 1)} />}</div>}
        <div className="ai-body">
          {tab === 'agents' && <AiAgentPanel agents={agents} progress={progress} />}
          {tab === 'memory' && <AiMemoryPanel enabled={config?.memoryEnabled ?? true} refreshKey={memoryRefresh} />}
          {tab === 'research' && <>
            {!turns.length && <div className="ai-start"><h3>你提问题，团队来研究</h3><p className="ai-muted">先识别股票与研究重点，再由专家分析、多空互评和风险审查。可直接使用股票名称。</p><div className="ai-quick-questions">{['分析中国神华A股的分红和风险', '腾讯近期走势怎么样？', '比较中国神华A股和H股的估值', '贵州茅台适合长期关注吗？'].map((text) => <button key={text} onClick={() => { setQuestion(text); input.current?.focus(); }}><FileCheck2 size={15} />{text}</button>)}</div></div>}
            {turns.map((turn, index) => <article className="ai-turn" key={turn.id}>
              <div className="ai-question"><div className="ai-muted">{turn.code || '自动识别标的'} · {modeNames[turn.mode]}</div><p>{turn.question}</p></div>
              <ResearchPlanView plan={turn.plan || turn.result?.researchPlan} />
              {(turn.result?.agentReports || turn.trace || (index === turns.length - 1 && progress?.agentReports)) && <details className="ai-execution"><summary>思考与工具调用{!turn.result && !turn.error && progress ? ` · ${progress.stage}` : ''}</summary><AiAgentPanel agents={turn.result?.agentReports || turn.trace || progress?.agentReports || []} progress={null} /></details>}
              {turn.error && <p role="alert" className="ai-error">{turn.error}</p>}
              {turn.result && <><div className="ai-result-meta"><span>研究完成 · {turn.result.runtime === 'fallback' ? '兼容模式' : turn.result.runtime === 'mixed' ? '混合运行时' : 'DeepSeek Harness'}</span><div className="ai-toolbar"><button className="ai-icon" title={turn.result.remembered ? '已保存研究记忆' : '保存研究记忆'} aria-label={turn.result.remembered ? '已保存研究记忆' : '保存研究记忆'} disabled={!config?.memoryEnabled || turn.result.remembered || Boolean(rememberPending)} onClick={() => void remember(turn)}>{rememberPending === turn.id ? <LoaderCircle size={14} className="animate-spin" /> : <Bookmark size={14} fill={turn.result.remembered ? 'currentColor' : 'none'} />}</button><button className="ai-icon" title="复制结论" aria-label="复制结论" onClick={() => void copy(turn.result!.answer)}><Clipboard size={14} /></button></div></div><Answer text={turn.result.answer} prefix={turn.id} /><Evidence items={turn.result.evidence} prefix={turn.id} />{turn.result.remembered && <p className="ai-muted">已保存本次研究记忆</p>}</>}
              {!turn.result && !turn.error && <div className="ai-waiting"><LoaderCircle size={16} className="animate-spin" />{progress?.stage || '正在识别股票与研究问题'}</div>}
            </article>)}
            <div ref={end} />
          </>}
        </div>
        {notice && <div className="ai-notice" role="status">{notice}<button className="ai-icon" aria-label="关闭提示" onClick={() => setNotice('')}><X size={13} /></button></div>}
        <form className="ai-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="ai-context"><label>参考标的（可不填）<input aria-label="研究标的代码或名称" value={contextCode} onChange={(event) => setContextCode(event.target.value)} maxLength={80} placeholder="AI 会从问题中识别股票" disabled={Boolean(runId)} /></label>{contextCode && <button type="button" className="ai-icon" title="移除标的" aria-label="移除标的" disabled={Boolean(runId)} onClick={() => setContextCode('')}><X size={13} /></button>}</div>
          <textarea ref={input} aria-label="研究问题" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：腾讯和茅台，哪只更适合长期关注？" rows={3} maxLength={4000} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
          <div className="ai-composer-footer"><div className="ai-mode" role="group" aria-label="研究深度">{(['quick', 'standard', 'deep'] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} disabled={Boolean(runId)} onClick={() => setMode(value)} title={value === 'deep' ? '36 个角色分工会诊；数据不足的角色会跳过，耗时更长' : `${modeNames[value]}研究`}>{modeNames[value]}</button>)}</div>{runId ? <button className="ai-send ai-stop" type="button" title="停止研究" aria-label="停止研究" disabled={stopPending} onClick={() => void stop()}>{stopPending ? <LoaderCircle size={17} className="animate-spin" /> : <Square size={16} />}</button> : <button className="ai-send" type="submit" title="发送问题" aria-label="发送问题" disabled={!ready || question.trim().length < 2}><ArrowUp size={20} /></button>}</div>
          <p className="ai-muted ai-mode-description">{mode === 'deep' ? '36 个角色会诊；按市场和可用数据执行，耗时较长。' : '按问题选择重点专家，保留多空互评和风险审查。'}</p>
          {!ready && <button type="button" className="ai-link" onClick={() => setSettingsOpen(true)}>配置模型服务</button>}
        </form>
      </aside>}
      {settingsOpen && <AiSettingsDialog />}
    </div>
  );
}
