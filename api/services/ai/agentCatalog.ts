import type { FinanceSnapshot } from './types.js';

export type ResearchMode = 'quick' | 'standard' | 'deep';
export type AgentPhase = 'analysis' | 'challenge' | 'review' | 'synthesis';

export interface FinanceAgent {
  id: string;
  name: string;
  desk: string;
  phase: AgentPhase;
  mandate: string;
  evidenceIds: string[];
  markets?: Array<'A' | 'HK'>;
  requires?: 'holders' | 'moneyflow';
}

function analyst(id: string, name: string, desk: string, mandate: string, evidenceIds: string[], extra: Partial<FinanceAgent> = {}): FinanceAgent {
  return { id, name, desk, mandate, evidenceIds, phase: 'analysis', ...extra };
}

export const FINANCE_AGENTS: readonly FinanceAgent[] = [
  analyst('market-price', '行情分析师', '市场', '核对最新价格、涨跌幅和行情时间，明确日线与实时口径差异。', ['E2']),
  analyst('price-action', '价格行为分析师', '技术', '解释最近一根日线的实体、振幅与收盘位置，仅使用已有 OHLC。', ['E3']),
  analyst('volume', '成交量分析师', '技术', '检查最近成交量与二十日均量比，避免把成交活跃等同于上涨。', ['E3']),
  analyst('trend', '趋势分析师', '技术', '解释 TET 趋势与指标限制，不编造价格目标。', ['E5']),
  analyst('momentum', '动量分析师', '技术', '解释 MACD-V 动量及其与价格变化是否一致。', ['E5']),
  analyst('technical-divergence', '技术分歧分析师', '技术', '比较趋势、动量和近期收益，指出技术信号之间的分歧。', ['E3', 'E5']),
  analyst('volatility', '波动风险分析师', '风险', '依据当前日线振幅和近期收益解释波动风险，不估造年化波动率。', ['E3']),
  analyst('liquidity', '流动性分析师', '风险', '分析可见的成交额、成交量、换手数据；没有盘口时不推断冲击成本。', ['E3']),
  analyst('valuation-pe', '市盈率分析师', '估值', '解释当前市盈率的意义和亏损口径；无行业基准时不得断言低估。', ['E4']),
  analyst('valuation-pb', '市净率分析师', '估值', '解释市净率与资产质量核验需求，不把估算 ROE 当作财报事实。', ['E4']),
  analyst('dividend', '股息分析师', '估值', '只讨论已提供的股息率，区分历史股息和未来分红承诺。', ['E4']),
  analyst('size-turnover', '市值换手分析师', '市场', '解释市值和换手率口径，审查币种和数量单位。', ['E4']),
  analyst('shareholders', '股权结构分析师', '基本面', '分析最近一期已披露股东结构，明确报告期不能代表实时持仓。', ['E6'], { requires: 'holders', markets: ['A'] }),
  analyst('ownership-concentration', '股权集中度分析师', '风险', '检查十大股东集中度和披露滞后，不推断未披露的增减持。', ['E6'], { requires: 'holders', markets: ['A'] }),
  analyst('moneyflow', '资金流分析师', '资金', '解释提供的资金流向及其交易日，不能将算法资金分类称为机构真实持仓。', ['E6'], { requires: 'moneyflow', markets: ['A'] }),
  analyst('flow-price', '量价资金分析师', '资金', '核对资金流与价格方向的一致性，先检查两者交易日是否相同。', ['E6', 'E3'], { requires: 'moneyflow', markets: ['A'] }),
  analyst('ah-premium', 'A/H 溢价分析师', '跨市场', '解释 A/H 折溢价和换汇计算，并说明不同市场股份不可直接互换。', ['E7']),
  analyst('fx-basis', '汇率口径分析师', '跨市场', '核查 A/H 价格比较中的汇率、币种、时间差与可比性。', ['E7']),
  analyst('crowding', '拥挤度分析师', '风险', '解释拥挤度模型信号及其样本限制，不把模型标签视为确定结论。', ['E8']),
  analyst('data-quality', '数据质量分析师', '证据', '核对时间、来源、空值、冲突与估算标签，列出影响结论的数据缺口。', []),
  analyst('market-structure', '交易制度分析师', '跨市场', '只核验快照中明确存在的市场与币种；交易制度未提供证据时列为待核验项。', ['E2']),
  analyst('earnings', '盈利质量分析师', '基本面', '核对财报中的利润与现金流匹配、非经常性损益和会计口径。', ['E10']),
  analyst('balance-sheet', '资产负债分析师', '基本面', '核对偿债能力、债务期限与资产质量。', ['E11']),
  analyst('cash-flow', '现金流分析师', '基本面', '比较经营现金流、资本支出与自由现金流，列出计算口径。', ['E12']),
  analyst('growth', '成长性分析师', '基本面', '比较收入和利润增长的基数、可持续性与报告期。', ['E10']),
  analyst('sector', '行业比较分析师', '行业', '依据可比公司与行业统计比较估值、景气度和竞争位置。', ['E13']),
  analyst('macro', '宏观分析师', '宏观', '检查宏观数据发布时间与影响路径，区分相关性和因果。', ['E14']),
  analyst('news', '新闻事件分析师', '事件', '使用可核验新闻的原始来源与发布时间分析事件影响。', ['E9']),
  analyst('disclosures', '公告分析师', '事件', '依据公司原始公告审查事项、日期和财务影响。', ['E15']),
  analyst('southbound', '港股通分析师', '资金', '核验南向资金交易日和持仓口径，不以净流入推断必然上涨。', ['E16'], { markets: ['HK'] }),
  analyst('corporate-actions', '公司行动分析师', '事件', '核对拆股、分红、供股等公司行动与复权口径。', ['E17']),
  analyst('portfolio', '组合风险分析师', '组合', '根据实际持仓和权重评估集中度；缺少仓位时不构造用户组合。', ['E18']),
  { id: 'bull-case', name: '多头论证员', desk: '交叉审查', phase: 'challenge', mandate: '基于已完成分析构建有条件的多头情景，指出成立条件和反证。', evidenceIds: [] },
  { id: 'bear-case', name: '空头论证员', desk: '交叉审查', phase: 'challenge', mandate: '基于已完成分析构建风险情景，区分证据支持的风险与数据缺失。', evidenceIds: [] },
  { id: 'risk-review', name: '独立风险审查员', desk: '交叉审查', phase: 'review', mandate: '审查多空论证的冲突、过度确定性、时效和引用错误，给出待核验事项。', evidenceIds: [] },
  { id: 'chief-analyst', name: '研究总编', desk: '研究结论', phase: 'synthesis', mandate: '汇总证据和分歧，按结论、支撑证据、主要风险、下一步核验输出最终答复。不得新增事实。', evidenceIds: [] },
];

const QUICK_IDS = new Set(['market-price', 'trend', 'data-quality', 'risk-review', 'chief-analyst']);
const STANDARD_IDS = new Set(['market-price', 'price-action', 'volume', 'trend', 'momentum', 'valuation-pe', 'moneyflow', 'ah-premium', 'crowding', 'data-quality', 'news', 'bull-case', 'bear-case', 'risk-review', 'chief-analyst']);

export function selectAgents(mode: ResearchMode): FinanceAgent[] {
  return FINANCE_AGENTS.filter((agent) => mode === 'deep' || (mode === 'quick' ? QUICK_IDS : STANDARD_IDS).has(agent.id));
}

const MODE_SPECIALIST_LIMIT: Record<ResearchMode, number> = { quick: 3, standard: 11, deep: 32 };

/** Agent IDs come from the model plan; the server caps depth and owns debate/final roles. */
export function selectRoutedAgents(mode: ResearchMode, requestedIds: string[], questionType: string): FinanceAgent[] {
  const orderedIds = [...new Set([...requestedIds, ...(mode === 'deep' ? FINANCE_AGENTS.filter(agent => agent.phase === 'analysis').map(agent => agent.id) : [])])];
  const specialists = orderedIds.map(id => FINANCE_AGENTS.find(agent => agent.id === id && agent.phase === 'analysis')).filter((agent): agent is FinanceAgent => Boolean(agent));
  const selected = specialists.slice(0, MODE_SPECIALIST_LIMIT[mode]);
  if (questionType === 'comparison' || questionType === 'single_stock') {
    for (const id of ['bull-case', 'bear-case']) {
      const agent = FINANCE_AGENTS.find(candidate => candidate.id === id)!;
      if (selected.length < MODE_SPECIALIST_LIMIT[mode] + 2 && !selected.includes(agent)) selected.push(agent);
    }
  }
  for (const id of ['risk-review', 'chief-analyst']) {
    const agent = FINANCE_AGENTS.find(candidate => candidate.id === id)!;
    if (!selected.includes(agent)) selected.push(agent);
  }
  return selected;
}

export function unavailableReason(agent: FinanceAgent, snapshot: FinanceSnapshot): string | undefined {
  const applicableCodes = snapshot.stocks?.filter(stock => !agent.markets || agent.markets.includes(stock.market)).map(stock => stock.code);
  if (snapshot.stocks?.length && agent.markets && !applicableCodes?.length) return '当前标的市场不适用。';
  if (!snapshot.stocks?.length && agent.markets && !agent.markets.some((market) => market === snapshot.market)) return '当前标的市场不适用。';
  const usable = snapshot.evidence.filter((item) => item.status === 'available' || item.status === 'partial');
  if (snapshot.stocks?.length && agent.evidenceIds.length) {
    const hasRelevant = usable.some(item => agent.evidenceIds.includes(item.sourceEvidenceId ?? item.id)
      && (!item.stockCode || applicableCodes?.includes(item.stockCode)));
    if (!hasRelevant) return `所需证据暂不可用：${agent.evidenceIds.join('、')}。`;
    if (agent.requires) {
      const requiredEvidence = usable.filter(item => (item.sourceEvidenceId ?? item.id) === 'E6' && (!item.stockCode || applicableCodes?.includes(item.stockCode)));
      const available = requiredEvidence.some(item => {
        const data = item.data as { holders?: unknown[]; moneyFlow?: unknown } | undefined;
        return agent.requires === 'holders' ? Boolean(data?.holders?.length) : Boolean(data?.moneyFlow);
      });
      if (!available) return agent.requires === 'holders' ? '未取得当前可用的股东披露记录。' : '未取得当前可用的资金流记录。';
    }
    return undefined;
  }
  const missing = agent.evidenceIds.filter((id) => !usable.some((item) => (item.sourceEvidenceId ?? item.id) === id));
  if (missing.length) return `缺少可核验数据：${missing.join('、')}。`;
  if (agent.requires) {
    const data = usable.find((item) => item.id === 'E6')?.data as { holders?: unknown[]; moneyFlow?: unknown } | undefined;
    if (agent.requires === 'holders' && !data?.holders?.length) return '未取得当前可用的股东披露记录。';
    if (agent.requires === 'moneyflow' && !data?.moneyFlow) return '未取得当前可用的资金流记录。';
  }
  return undefined;
}
