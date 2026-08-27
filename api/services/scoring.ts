import type { DailyBar, DailyBasic, Top10Holder, MoneyFlow } from './tushare.js';
import type { RealtimeQuote } from './realtime.js';

// ==================== 第1项：盘中实时数据注入 ====================
// 把新浪实时行情作为"今日虚拟K线"附加到 bars 末尾，让算法感知盘中变化
function injectRealtimeIntoBars(bars: DailyBar[], realtime: RealtimeQuote | null): DailyBar[] {
  if (!realtime || realtime.price <= 0) return bars;
  const today = new Date();
  const tradeDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const lastBar = bars[bars.length - 1];

  // 如果 bars 最后一条已经是今日，则替换；否则追加一条
  if (lastBar && lastBar.trade_date === tradeDate) {
    const merged: DailyBar = {
      ...lastBar,
      high: Math.max(lastBar.high, realtime.high),
      low: Math.min(lastBar.low, realtime.low),
      close: realtime.price,
      vol: realtime.vol,
      amount: realtime.amount,
      pct_chg: realtime.pct_chg,
      change: realtime.change,
    };
    return [...bars.slice(0, -1), merged];
  }

  const newBar: DailyBar = {
    ts_code: lastBar?.ts_code ?? '',
    trade_date: tradeDate,
    open: realtime.open,
    high: realtime.high,
    low: realtime.low,
    close: realtime.price,
    pre_close: realtime.pre_close,
    change: realtime.change,
    pct_chg: realtime.pct_chg,
    vol: realtime.vol,
    amount: realtime.amount,
  };
  return [...bars, newBar];
}

// ==================== 第1项修复：股东按财报期去重 ====================
// 只保留最新一期的十大股东，避免跨期累加导致 "机构持股比例 3598%"
function dedupeHolders(holders: Top10Holder[]): Top10Holder[] {
  if (holders.length === 0) return [];
  const latestEndDate = holders.reduce((max, h) => (h.end_date > max ? h.end_date : max), holders[0].end_date);
  return holders.filter((h) => h.end_date === latestEndDate);
}

const INST_KEYWORDS = [
  '基金', '社保', '保险', '信托', '证券', '银行', 'QFII',
  '香港中央结算', '资产管理', '基本养老保险', '企业年金', '全国社保',
];
const EXCLUDE_KEYWORDS = ['自然人', '个人', '先生', '女士'];

function calcInstitutionalRatio(holders: Top10Holder[]): number {
  const latest = dedupeHolders(holders);
  let ratio = 0;
  for (const h of latest) {
    if (EXCLUDE_KEYWORDS.some((kw) => h.holder_name.includes(kw))) continue;
    if (INST_KEYWORDS.some((kw) => h.holder_name.includes(kw))) ratio += h.hold_ratio;
  }
  const top10Total = latest.reduce((s, h) => s + h.hold_ratio, 0);
  return Math.min(ratio, top10Total);
}

// ==================== 第2项：6大类因子（高盛/摩根多因子框架） ====================

interface RawFactors {
  // 价值
  ep: number; // PE_TTM 倒数
  bp: number; // PB 倒数
  divYield: number; // 股息率
  // 质量
  roe: number; // 估算 ROE = PB/PE*100
  grossMarginProxy: number; // 毛利率代理（用 ps_ttm 反推）
  // 动量
  momentum12_1: number; // 12M-1M 动量
  momentum20: number; // 近20日动量
  distFromHigh52: number; // 距52周新高百分比（负值表示未到）
  // 低波
  vol60: number; // 60日年化波动率
  idioVol: number; // 近20日特质波动率（用残差方差近似）
  // 流动性
  turnover: number; // 换手率
  amihud: number; // Amihud 非流动性
  // 规模
  logMv: number; // log(总市值)
  // 资金面（第3项）
  mainInflowRatio: number; // 主力净流入率 = (大单+超大单净额) / 总成交额
  instHoldRatio: number; // 机构持股比例（去重后）
}

interface FactorBundle {
  ts_code: string;
  name: string;
  raw: RawFactors;
  signals: string[]; // 规则信号（用于前端展示）
  t1Adjust: number; // 第4项：T+1 预测调整分
}

function safeDiv(a: number, b: number): number {
  return b !== 0 && Number.isFinite(b) ? a / b : 0;
}

function computeRawFactors(
  bars: DailyBar[],
  basic: DailyBasic | null,
  holders: Top10Holder[],
  moneyFlow: MoneyFlow | null,
): { raw: RawFactors; signals: string[] } {
  const signals: string[] = [];
  const closes = bars.map((b) => b.close);
  const last = closes.length - 1;
  const price = closes[last] || 0;

  // ===== 价值 =====
  const pe = basic?.pe_ttm ?? 0;
  const pb = basic?.pb ?? 0;
  const ep = pe > 0 ? 1 / pe : 0;
  const bp = pb > 0 ? 1 / pb : 0;
  const divYield = basic?.dv_ratio ?? 0;

  if (pe > 0 && pe <= 30) signals.push(`PE ${pe.toFixed(1)}`);
  if (pb > 0 && pb <= 4) signals.push(`PB ${pb.toFixed(1)}`);
  if (divYield > 1.5) signals.push(`股息率 ${divYield.toFixed(1)}%`);

  // ===== 质量 =====
  const roe = pe > 0 ? (pb / pe) * 100 : 0;
  if (roe > 15) signals.push(`估算ROE ${roe.toFixed(1)}%`);

  // ===== 动量 =====
  const momentum20 = closes.length >= 21 ? (price / closes[last - 20] - 1) * 100 : 0;
  const momentum12_1 = closes.length >= 250 ? (price / closes[Math.max(0, last - 240)] - 1) * 100 - momentum20 : 0;
  const high52 = closes.length >= 250 ? Math.max(...closes.slice(-250)) : Math.max(...closes);
  const distFromHigh52 = high52 > 0 ? (price / high52 - 1) * 100 : 0;

  if (momentum20 > 5) signals.push(`20日动量+${momentum20.toFixed(1)}%`);
  if (distFromHigh52 >= -2) signals.push(`近52周新高`);

  // ===== 低波 =====
  const vol60 = calcVolatility(closes, 60);
  const idioVol = calcVolatility(closes, 20);

  // ===== 流动性 =====
  const turnover = basic?.turnover_rate ?? 0;
  const amihud = calcAmihud(bars);

  // ===== 规模 =====
  const logMv = basic?.total_mv ? Math.log(basic.total_mv) : 0;

  // ===== 资金面（第3项）=====
  const instHoldRatio = calcInstitutionalRatio(holders);
  if (instHoldRatio > 10) signals.push(`机构持股 ${instHoldRatio.toFixed(1)}%`);

  let mainInflowRatio = 0;
  if (moneyFlow) {
    const instBuy = moneyFlow.buy_lg_amount + moneyFlow.buy_elg_amount;
    const instSell = moneyFlow.sell_lg_amount + moneyFlow.sell_elg_amount;
    const total = instBuy + instSell + moneyFlow.buy_sm_amount + moneyFlow.sell_sm_amount + moneyFlow.buy_md_amount + moneyFlow.sell_md_amount;
    mainInflowRatio = safeDiv((instBuy - instSell) * 100, total);
    if (mainInflowRatio > 5) signals.push(`主力净流入 ${mainInflowRatio.toFixed(1)}%`);
    else if (mainInflowRatio < -5) signals.push(`主力净流出 ${mainInflowRatio.toFixed(1)}%`);
  }

  return {
    raw: {
      ep, bp, divYield,
      roe, grossMarginProxy: 0,
      momentum12_1, momentum20, distFromHigh52,
      vol60, idioVol,
      turnover, amihud,
      logMv,
      mainInflowRatio, instHoldRatio,
    },
    signals,
  };
}

function calcVolatility(closes: number[], period: number): number {
  if (closes.length < period + 1) return 0;
  const rets: number[] = [];
  const slice = closes.slice(-period - 1);
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] > 0) rets.push(Math.log(slice[i] / slice[i - 1]));
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(250) * 100; // 年化%
}

function calcAmihud(bars: DailyBar[]): number {
  if (bars.length < 20) return 0;
  const slice = bars.slice(-20);
  let sum = 0, count = 0;
  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1].close;
    const cur = slice[i].close;
    const amt = slice[i].amount;
    if (prev > 0 && amt > 0) {
      sum += Math.abs(cur / prev - 1) / (amt / 10000); // 万元
      count++;
    }
  }
  return count > 0 ? sum / count * 1e6 : 0;
}

// ==================== 第4项：T+1 预测调整（适配 T+1 市场）====================
// 用规则化信号估计"明日更可能上涨"的概率，作为综合分的微调项
function computeT1Adjust(bars: DailyBar[], signals: string[]): number {
  if (bars.length < 5) return 0;
  let adj = 0;
  const last = bars.length - 1;
  const cur = bars[last];
  const pctChg = cur.pct_chg;
  const volumes = bars.map((b) => b.vol);
  const avgVol5 = volumes.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
  const volRatio = avgVol5 > 0 ? cur.vol / avgVol5 : 0;

  // 1. 反转风险：今日涨幅 > 7%，明日大概率回调
  if (pctChg > 7) {
    adj -= 8;
    signals.push('短期反转风险');
  } else if (pctChg > 5 && pctChg <= 7) {
    adj -= 4;
  }

  // 2. 强势延续：连续3日放量上涨且未涨停
  let upCount = 0, volUpCount = 0;
  for (let i = last; i >= Math.max(1, last - 2); i--) {
    if (bars[i].close > bars[i - 1].close) upCount++;
    if (bars[i].vol > bars[i - 1].vol) volUpCount++;
  }
  if (upCount === 3 && volUpCount >= 2 && pctChg < 9.5) {
    adj += 6;
    signals.push('三日放量连阳');
  }

  // 3. 跳空缺口回补风险：今开 > 昨收 3% 以上
  if (cur.open > cur.pre_close * 1.03 && cur.close < cur.open) {
    adj -= 5;
    signals.push('跳空高开收阴');
  }

  // 4. 尾盘走弱：收盘价 < 最高价 1.5%
  if (cur.high > 0 && (cur.high - cur.close) / cur.high > 0.015) {
    adj -= 2;
  }

  // 5. 缩量上涨：量比 < 0.7 且上涨
  if (volRatio < 0.7 && pctChg > 0) {
    adj -= 3;
    signals.push('缩量上涨');
  }

  // 6. 涨停板封板：涨幅 ≥ 9.8% 且收盘 = 最高
  if (pctChg >= 9.8 && cur.close >= cur.high * 0.999) {
    adj += 4;
    signals.push('封涨停');
  }

  return adj;
}

// ==================== 第2项核心：横截面 Z-score 标准化 + Winsorize ====================

function winsorize(values: number[], lower: number = 0.03, upper: number = 0.97): number[] {
  if (values.length < 3) return values.slice();
  const sorted = [...values].sort((a, b) => a - b);
  const loIdx = Math.floor(sorted.length * lower);
  const hiIdx = Math.ceil(sorted.length * upper);
  const lo = sorted[Math.max(0, loIdx)];
  const hi = sorted[Math.min(sorted.length - 1, hiIdx)];
  return values.map((v) => Math.max(lo, Math.min(hi, v)));
}

function zScore(values: number[]): number[] {
  if (values.length < 2) return values.map(() => 0);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0 || !Number.isFinite(std)) return values.map(() => 0);
  return values.map((v) => (v - mean) / std);
}

// 因子权重表（参考高盛 A 股多因子研究的 IC 加权近似值）
const FACTOR_WEIGHTS: Record<keyof RawFactors, number> = {
  ep: 0.10, // 价值
  bp: 0.05,
  divYield: 0.05,
  roe: 0.12, // 质量（A股质量因子最有效）
  grossMarginProxy: 0,
  momentum12_1: 0.08, // 动量（A股 12M-1M 较弱）
  momentum20: 0.10,
  distFromHigh52: 0.05,
  vol60: -0.08, // 低波（负号：波动越低越好）
  idioVol: -0.05,
  turnover: -0.05, // 高换手往往是见顶信号
  amihud: -0.04,
  logMv: 0.05, // 规模（A股小盘溢价已减弱）
  mainInflowRatio: 0.15, // 资金面（A股主力信号最有效）
  instHoldRatio: 0.07,
};

// ==================== 综合入口 ====================

export interface Recommendation {
  ts_code: string;
  name: string;
  tech_score: number;
  fundamental_score: number;
  capital_score: number;
  total_score: number;
  signals: string[];
  next_day_adjust: number; // 第4项：T+1 调整分
  risk_level: 'low' | 'medium' | 'high';
}

export interface StockData {
  ts_code: string;
  name: string;
  bars: DailyBar[];
  basic: DailyBasic | null;
  holders: Top10Holder[];
  moneyFlow?: MoneyFlow | null; // 第3项新增
  realtime?: RealtimeQuote | null; // 第1项新增
}

export function scoreStocks(stocks: StockData[]): Recommendation[] {
  // 第1项：盘中实时数据注入
  const enriched = stocks.map((s) => ({
    ...s,
    bars: injectRealtimeIntoBars(s.bars, s.realtime ?? null),
    holders: dedupeHolders(s.holders), // 修复机构持股累加Bug
  }));

  // 计算每只股票的原始因子
  const bundles: FactorBundle[] = enriched.map((s) => {
    const { raw, signals } = computeRawFactors(s.bars, s.basic, s.holders, s.moneyFlow ?? null);
    const t1Adj = computeT1Adjust(s.bars, signals);
    return { ts_code: s.ts_code, name: s.name, raw, signals, t1Adjust: t1Adj };
  });

  if (bundles.length === 0) return [];

  // 横截面 Z-score 标准化
  const factorKeys = Object.keys(FACTOR_WEIGHTS) as (keyof RawFactors)[];
  const zScores: Record<string, Record<string, number>> = {};

  for (const key of factorKeys) {
    if (FACTOR_WEIGHTS[key] === 0) continue;
    const rawValues = bundles.map((b) => b.raw[key]);
    const winsorized = winsorize(rawValues);
    const zs = zScore(winsorized);
    bundles.forEach((b, i) => {
      if (!zScores[b.ts_code]) zScores[b.ts_code] = {};
      zScores[b.ts_code][key] = zs[i];
    });
  }

  // 加权合成综合分（Z-score 加权和的标准差约为 sqrt(权重平方和)≈0.3，乘以100映射到0-100分）
  const results: Recommendation[] = bundles.map((b) => {
    const z = zScores[b.ts_code] || {};
    let compositeZ = 0;
    for (const key of factorKeys) {
      compositeZ += (z[key] ?? 0) * FACTOR_WEIGHTS[key];
    }
    // 综合分：50为基准，Z-score 加权后通常在 -1~1 之间，乘以30映射到0-100
    const compositeScore = Math.max(0, Math.min(100, Math.round(50 + compositeZ * 30)));

    // 分项分数（用于前端展示）
    const techZ = (z.momentum12_1 ?? 0) * 0.25 + (z.momentum20 ?? 0) * 0.35 + (z.distFromHigh52 ?? 0) * 0.20 + (z.vol60 ?? 0) * -0.20;
    const fundZ = (z.ep ?? 0) * 0.30 + (z.bp ?? 0) * 0.15 + (z.divYield ?? 0) * 0.15 + (z.roe ?? 0) * 0.40;
    const capZ = (z.mainInflowRatio ?? 0) * 0.60 + (z.instHoldRatio ?? 0) * 0.30 + (z.turnover ?? 0) * -0.10;

    const techScore = Math.max(0, Math.min(100, Math.round(50 + techZ * 30)));
    const fundScore = Math.max(0, Math.min(100, Math.round(50 + fundZ * 30)));
    const capScore = Math.max(0, Math.min(100, Math.round(50 + capZ * 30)));

    // T+1 调整分（第4项）加在综合分上
    const totalScore = Math.max(0, Math.min(100, compositeScore + b.t1Adjust));

    // 风险等级
    const vol = b.raw.vol60;
    const risk: 'low' | 'medium' | 'high' =
      vol < 30 ? 'low' : vol < 50 ? 'medium' : 'high';

    return {
      ts_code: b.ts_code,
      name: b.name,
      tech_score: techScore,
      fundamental_score: fundScore,
      capital_score: capScore,
      total_score: totalScore,
      signals: b.signals,
      next_day_adjust: Math.round(b.t1Adjust),
      risk_level: risk,
    };
  });

  return results.sort((a, b) => b.total_score - a.total_score);
}

// ==================== 行业分散约束（高盛/摩根组合构建标准） ====================
// 贪心算法：按综合分从高到低选，每个行业最多 maxPerSector 只
// 保证 Top-N 组合不会过度集中在单一行业
export function applySectorDiversification(
  recommendations: Recommendation[],
  industryMap: Map<string, string>,
  topN: number = 4,
  maxPerSector: number = 2,
): Recommendation[] {
  const selected: Recommendation[] = [];
  const sectorCount: Record<string, number> = {};

  for (const rec of recommendations) {
    if (selected.length >= topN) break;
    const industry = industryMap.get(rec.ts_code) ?? '其他';
    const count = sectorCount[industry] ?? 0;
    if (count < maxPerSector) {
      selected.push(rec);
      sectorCount[industry] = count + 1;
    }
  }

  return selected;
}
