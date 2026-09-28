import { Check, Circle, CircleAlert, LoaderCircle, Minus, X } from 'lucide-react';
import type { ResearchAgent, ResearchProgress } from '@/types/ai';

const states = {
  queued: { label: '排队中', Icon: Circle },
  running: { label: '分析中', Icon: LoaderCircle },
  completed: { label: '已完成', Icon: Check },
  skipped: { label: '已跳过', Icon: Minus },
  failed: { label: '失败', Icon: CircleAlert },
  cancelled: { label: '已停止', Icon: X },
};

const phases = { thinking: '正在思考', answering: '正在生成回答', tool: '正在读取工具数据' };
const toolStates = { running: '调用中', completed: '已完成', failed: '失败', cancelled: '已停止' };
const toolNames: Record<string, string> = { read_market_evidence: '读取市场证据', read_financial_statements: '读取财务报表' };

function AgentActivity({ agent }: { agent: ResearchAgent }) {
  return <div className="ai-agent-activity">
    {agent.reasoning && <details className="ai-reasoning"><summary>查看模型思考过程 · {agent.reasoning.length.toLocaleString()} 字</summary><p className="ai-muted">模型返回的中间分析，可能包含尚未核实的判断，请以最终结论及证据为准。Harness 在每一步思考结束后更新。</p><pre>{agent.reasoning}</pre>{agent.reasoningTruncated && <p className="ai-muted">展示已截取前 24,000 字，工具对话仍保留完整上下文。</p>}</details>}
    {!!agent.toolCalls?.length && <div className="ai-tool-list" aria-label={`${agent.name}工具调用`}>
      {agent.toolCalls.map(tool => <details className={`ai-tool ai-tool-${tool.status}`} key={tool.id}>
        <summary><span>{toolNames[tool.name] || tool.name}</span><small>{toolStates[tool.status]}</small></summary>
        <p className="ai-muted">{new Date(tool.startedAt).toLocaleTimeString('zh-CN')}{tool.completedAt && ` · ${Math.max(0, Date.parse(tool.completedAt) - Date.parse(tool.startedAt))} ms`}</p>
        <pre>{tool.arguments}</pre><p>{tool.summary || '等待工具结果'}</p>
        {!!tool.evidenceIds?.length && <p className="ai-muted">返回证据：{tool.evidenceIds.join('、')}</p>}
      </details>)}
    </div>}
  </div>;
}

export default function AiAgentPanel({ agents, progress }: { agents: ResearchAgent[]; progress: ResearchProgress | null }) {
  const groups = Array.from(new Set(agents.map((agent) => agent.desk)));
  return (
    <div className="ai-agents">
      <div className="ai-section-heading"><h3>专家团队</h3><span className="ai-muted">{agents.length} 个角色</span></div>
      {progress && <div className="ai-team-counts"><span>完成 {progress.completed}</span><span>跳过 {progress.skipped}</span><span>失败 {progress.failed}</span></div>}
      {!agents.length && <p className="ai-muted ai-empty">暂无团队信息</p>}
      {groups.map((team) => (
        <section className="ai-team" key={team}>
          <h4>{team}</h4>
          {agents.filter((agent) => agent.desk === team).map((agent) => {
            const state = agent.status ? states[agent.status] : null;
            const Icon = state?.Icon || Circle;
            return (
              <details className={`ai-agent-row ai-agent-${agent.status || 'idle'}`} key={agent.id}>
                <summary><Icon size={14} className={agent.status === 'running' ? 'animate-spin' : ''} /><span>{agent.name}</span><small>{agent.status === 'running' && agent.activity ? phases[agent.activity] : state?.label || '未调度'}</small></summary>
                <AgentActivity agent={agent} />
                {!!agent.debateRounds?.length && <details className="ai-reasoning"><summary>查看多空交流 · {agent.debateRounds.length} 轮</summary>{agent.debateRounds.map(round => <div key={round.round}><p className="ai-muted">{round.round === 1 ? '初轮论证' : '阅读对方观点后的回应'}</p><p className="ai-agent-answer">{round.answer}</p></div>)}</details>}
                {agent.reason && <p className="ai-muted">{agent.reason}</p>}
                {agent.answer && <p className="ai-agent-answer">{agent.answer}</p>}
                {!!agent.evidenceIds?.length && <p className="ai-muted">证据 {agent.evidenceIds.join('、')}</p>}
                {!agent.reason && !agent.answer && <p className="ai-muted">{agent.status === 'running' ? '正在形成研究意见' : '暂无研究意见'}</p>}
              </details>
            );
          })}
        </section>
      ))}
    </div>
  );
}
