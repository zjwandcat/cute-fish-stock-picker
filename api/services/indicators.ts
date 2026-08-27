/**
 * 技术指标与买卖信号算法库
 *
 * 核心算法来源：
 * 1. TET (Trend-Emotion-Timing) — Dr. Oliver Reiss, CFTe, MFTA
 *    NAAIM Founders Award 2025 论文
 *    https://naaim.org/wp-content/uploads/2025/05/2025_00F_Trend-Emotion-Timing-Dr.-Oliver-Reiss-CFTe-MFTA.pdf
 *    - Trend-Score: 40 个趋势跟踪指标（ROC/SMA/Crossover/线性回归 × 多周期）投票平均，[-1,1]
 *    - Emotion-Index: 12 个振荡器（重标 RSI × 6 周期 + 重标 K 线区间 × 6 周期）平均，[-1,1]
 *    - Anchored-Trend-Score: 在情绪最平静（|Emotion| 最小）时刻评估的 Trend-Score
 *    - Timing-Indicator = Anchored-Trend-Score − Emotion-Index，|值| > 1.0 为显著时机信号
 *
 * 2. MACD-V (Volatility Normalised Momentum) — Alex Spiroglou, CFTe
 *    SSRN #4099617 / NAAIM Founders Award 2022 / CMT Charles H. Dow Award 2022
 *    https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4099617
 *    - MACD-V = (EMA12 − EMA26) / ATR26 × 100
 *    - 信号线 = MACD-V 的 EMA9；柱 = MACD-V − 信号线
 *    - 动量生命周期路线图：±strong / ±extreme 阈值划分 7 个阶段（阈值可由用户自定义）
 *
 * 3. 针对 A 股短线有效的卖出信号机制（止盈止损之外）
 */

import type { DailyBar } from './tushare.js';

/* ==================== 基础数学工具 ==================== */

/** 简单移动平均序列（与输入等长，前 n-1 项为 NaN） */
function sma(values: number[], n: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (n <= 0 || values.length < n) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** 指数移动平均序列 */
function ema(values: number[], n: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (n <= 0 || values.length === 0) return out;
  const k = 2 / (n + 1);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/** Wilder RSI 序列 */
function rsi(closes: number[], n: number): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;
  out[n] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (n - 1) + Math.max(d, 0)) / n;
    avgLoss = (avgLoss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Wilder ATR 序列 */
function atr(bars: DailyBar[], n: number): number[] {
  const len = bars.length;
  const out = new Array<number>(len).fill(NaN);
  if (len <= n) return out;
  const tr: number[] = new Array(len).fill(0);
  tr[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < len; i++) {
    tr[i] = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
  }
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += tr[i];
  let a = sum / n;
  out[n] = a;
  for (let i = n + 1; i < len; i++) {
    a = (a * (n - 1) + tr[i]) / n;
    out[i] = a;
  }
  return out;
}

/** 线性回归：返回 [斜率, 斜率标准误] */
function linreg(values: number[]): { slope: number; stderr: number } {
  const n = values.length;
  if (n < 3) return { slope: 0, stderr: Infinity };
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += values[i];
    sxy += i * values[i];
    sxx += i * i;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { slope: 0, stderr: Infinity };
  const slope = (n * sxy - sx * sy) / denom;
  // 残差标准差
  const intercept = (sy - slope * sx) / n;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const e = values[i] - (intercept + slope * i);
    sse += e * e;
  }
  const seSlope = Math.sqrt((sse / (n - 2)) / denom);
  return { slope, stderr: seSlope };
}

/* ==================== TET 算法（NAAIM 2025） ==================== */

/** Trend-Score 用的周期配置（论文 Figure 1） */
const ROC_PERIODS = [24, 32, 48, 64, 96, 128, 192, 256, 384, 512];
const SMA_PERIODS = [24, 32, 48, 64, 96, 128, 192, 256, 384, 512];
const CROSSOVER_PAIRS: [number, number][] = [
  [20, 50],
  [50, 100],
  [100, 200],
  [20, 100],
  [50, 200],
];
// 线性回归周期：3m~18m ≈ 63~378 个交易日
const LINREG_PERIODS = [63, 84, 105, 126, 147, 168, 189, 252, 315, 378];

/** Emotion-Index 用的周期配置（论文 Figure 2） */
const RSI_PERIODS = [5, 8, 11, 14, 17, 20];
const CANDLERANGE_PERIODS = [3, 6, 9, 12, 15, 18];

/** 锚定窗口：在最近 N 日内寻找 |Emotion| 最小的时刻评估 Trend-Score */
const ANCHOR_WINDOW = 30;

export interface TETResult {
  trend_score: number; // 趋势分 [-1,1]，>0 上升趋势
  emotion_index: number; // 情绪指数 [-1,1]，>0 超买，<0 超卖
  anchored_trend: number; // 锚定趋势分（情绪最平静时的趋势分）
  timing: number; // 时机指标 = 锚定趋势 − 当前情绪
  valid_votes: number; // 有效趋势票数（共 40）
  bars_count: number; // 参与计算的 K 线数
  /** 卖出视角解读 */
  sell_signal: 'none' | 'weak' | 'strong';
  sell_reason: string;
  /** 买入视角解读 */
  buy_signal: 'none' | 'watch' | 'good';
  buy_reason: string;
}

/**
 * 计算 TET 指标。
 * bars 需按时间升序（旧→新），建议至少 550 根（不足时按有效票归一化）。
 */
export function computeTET(bars: DailyBar[]): TETResult {
  const len = bars.length;
  if (len < 2) {
    return {
      trend_score: 0,
      emotion_index: 0,
      anchored_trend: 0,
      timing: 0,
      valid_votes: 0,
      bars_count: len,
      sell_signal: 'none',
      sell_reason: 'K线数据不足，无法计算TET',
      buy_signal: 'none',
      buy_reason: 'K线数据不足，无法计算TET',
    };
  }
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);

  /* ---- 每日趋势投票（40 票） ---- */
  // 每个指标对“最近 ANCHOR_WINDOW 天 + 当天”输出投票序列
  const needDays = Math.min(len, ANCHOR_WINDOW + 1);
  const startIdx = len - needDays;
  const votes: number[][] = []; // votes[k][j] = 第 k 票在第 j 天的投票

  // 1) Rate of Change：价格高于 n 天前？
  for (const n of ROC_PERIODS) {
    const v: number[] = [];
    for (let i = startIdx; i < len; i++) {
      v.push(i >= n ? Math.sign(closes[i] - closes[i - n]) : 0);
    }
    votes.push(v);
  }
  // 2) SMA：价格在 SMA 上/下？
  for (const n of SMA_PERIODS) {
    const s = sma(closes, n);
    const v: number[] = [];
    for (let i = startIdx; i < len; i++) {
      v.push(Number.isNaN(s[i]) ? 0 : Math.sign(closes[i] - s[i]));
    }
    votes.push(v);
  }
  // 3) Crossover：短 SMA 在长 SMA 上/下？
  for (const [a, b] of CROSSOVER_PAIRS) {
    const sa = sma(closes, a);
    const sb = sma(closes, b);
    const v: number[] = [];
    for (let i = startIdx; i < len; i++) {
      v.push(Number.isNaN(sa[i]) || Number.isNaN(sb[i]) ? 0 : Math.sign(sa[i] - sb[i]));
    }
    votes.push(v);
  }
  // 4) 线性回归：斜率显著大于/小于 0（|slope| >= 标准误才计票，论文规则）
  for (const n of LINREG_PERIODS) {
    const v: number[] = [];
    for (let i = startIdx; i < len; i++) {
      if (i + 1 < n) {
        v.push(0);
        continue;
      }
      const { slope, stderr } = linreg(closes.slice(i + 1 - n, i + 1));
      v.push(Math.abs(slope) < stderr ? 0 : Math.sign(slope));
    }
    votes.push(v);
  }

  /* ---- 每日情绪指数（12 个振荡器） ---- */
  const rsiSeries = RSI_PERIODS.map((n) => rsi(closes, n));
  const emotionDaily: number[] = [];
  for (let i = startIdx; i < len; i++) {
    let sum = 0;
    let cnt = 0;
    for (const s of rsiSeries) {
      if (!Number.isNaN(s[i])) {
        sum += (2 * s[i]) / 100 - 1; // RSI(0~100) 重标到 [-1,1]，论文 2.0*RSI-1.0
        cnt++;
      }
    }
    for (const n of CANDLERANGE_PERIODS) {
      if (i + 1 >= n) {
        const hi = Math.max(...highs.slice(i + 1 - n, i + 1));
        const lo = Math.min(...lows.slice(i + 1 - n, i + 1));
        if (hi > lo) {
          sum += (2 * (closes[i] - lo)) / (hi - lo) - 1;
          cnt++;
        }
      }
    }
    emotionDaily.push(cnt > 0 ? sum / cnt : 0);
  }

  /* ---- 每日 Trend-Score（有效票归一化，数据不足的新股同样有效） ---- */
  const trendDaily: number[] = [];
  for (let j = 0; j < needDays; j++) {
    let sum = 0;
    let cnt = 0;
    for (const v of votes) {
      if (v[j] !== 0) {
        sum += v[j];
        cnt++;
      }
    }
    trendDaily.push(cnt > 0 ? sum / cnt : 0);
  }

  const trendScore = trendDaily[needDays - 1];
  const emotion = emotionDaily[needDays - 1];

  /* ---- Anchored-Trend-Score：窗口内 |Emotion| 最小的日子 ---- */
  let anchorIdx = 0;
  let minAbs = Infinity;
  for (let j = 0; j < needDays; j++) {
    const a = Math.abs(emotionDaily[j]);
    if (a < minAbs) {
      minAbs = a;
      anchorIdx = j;
    }
  }
  const anchoredTrend = trendDaily[anchorIdx];
  const timing = anchoredTrend - emotion;

  let validVotes = 0;
  for (const v of votes) if (v[needDays - 1] !== 0) validVotes++;

  /* ---- 卖出解读：趋势跟踪用反向信号退出（论文 1.3 节结论） ---- */
  // 趋势转空 = 强卖出；情绪超买（短期均值回归风险）= 弱卖出
  let sellSignal: TETResult['sell_signal'] = 'none';
  let sellReason = '趋势与情绪均无卖出信号';
  if (trendScore < -0.1) {
    sellSignal = 'strong';
    sellReason = `趋势分 ${trendScore.toFixed(2)} 已转空，趋势反转，按论文应立即退出`;
  } else if (trendScore < 0.15 && emotion > 0.5) {
    sellSignal = 'weak';
    sellReason = `情绪指数 ${emotion.toFixed(2)} 显著超买，趋势动能不足（${trendScore.toFixed(2)}），短期均值回归风险大`;
  } else if (emotion > 0.7) {
    sellSignal = 'weak';
    sellReason = `情绪指数 ${emotion.toFixed(2)} 极度超买，短期回调概率高，注意减仓`;
  } else if (trendScore < 0.15) {
    sellSignal = 'weak';
    sellReason = `趋势分仅 ${trendScore.toFixed(2)}，趋势动能弱，持股需谨慎`;
  }

  /* ---- 买入解读：上升趋势 + 当前超卖回调 = 论文最佳买点 ---- */
  let buySignal: TETResult['buy_signal'] = 'none';
  let buyReason = '暂无买入时机信号';
  if (anchoredTrend > 0.2 && emotion < -0.2 && Math.abs(timing) >= 1.0) {
    buySignal = 'good';
    buyReason = `锚定趋势 ${anchoredTrend.toFixed(2)} 上升、当前情绪 ${emotion.toFixed(2)} 超卖回调，Timing=${timing.toFixed(2)} 超过 1.0 显著阈值，符合论文最佳买点`;
  } else if (anchoredTrend > 0.2 && emotion < 0) {
    buySignal = 'good';
    buyReason = `上升趋势（锚定 ${anchoredTrend.toFixed(2)}）中短期回调（情绪 ${emotion.toFixed(2)}），可关注回踩买入`;
  } else if (anchoredTrend > 0.2) {
    buySignal = 'watch';
    buyReason = `趋势向上（锚定 ${anchoredTrend.toFixed(2)}）但当前情绪 ${emotion.toFixed(2)} 未超卖，等回调再介入`;
  } else if (anchoredTrend < -0.2) {
    buySignal = 'none';
    buyReason = `锚定趋势 ${anchoredTrend.toFixed(2)} 向下，不满足论文买入条件`;
  }

  return {
    trend_score: +trendScore.toFixed(3),
    emotion_index: +emotion.toFixed(3),
    anchored_trend: +anchoredTrend.toFixed(3),
    timing: +timing.toFixed(3),
    valid_votes: validVotes,
    bars_count: len,
    sell_signal: sellSignal,
    sell_reason: sellReason,
    buy_signal: buySignal,
    buy_reason: buyReason,
  };
}

/* ==================== MACD-V 算法（SSRN #4099617） ==================== */

export interface MACDVConfig {
  strong: number; // 强势阈值，默认 50
  extreme: number; // 极端阈值，默认 150
}

export const DEFAULT_MACDV: MACDVConfig = { strong: 50, extreme: 150 };

export interface MACDVResult {
  macdv: number; // 当前 MACD-V 值
  signal: number; // 信号线（MACD-V 的 EMA9）
  histogram: number; // 柱状图 = MACD-V − 信号线
  prev_histogram: number; // 前一日柱（判断柱体收缩/放大）
  stage: number; // 动量生命周期阶段 1~7
  stage_text: string; // 阶段中文描述
  stage_action: string; // 该阶段的操作建议（论文 Momentum Lifecycle RoadMap）
  /** 卖出视角 */
  sell_signal: 'none' | 'weak' | 'strong';
  sell_reason: string;
  /** 买入视角 */
  buy_signal: 'none' | 'watch' | 'good';
  buy_reason: string;
}

/**
 * 计算 MACD-V。bars 按时间升序，建议 ≥ 60 根。
 * 阈值可由用户自定义（strong/extreme），用于改变卖出信号的灵敏度。
 */
export function computeMACDV(bars: DailyBar[], cfg: MACDVConfig = DEFAULT_MACDV): MACDVResult {
  const closes = bars.map((b) => b.close);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  // 上市不足 27 日的次新股：ATR 周期自适应缩短（保持波动率归一化的可用性）
  const atrPeriod = Math.min(26, Math.max(2, bars.length - 1));
  const atr26 = atr(bars, atrPeriod);

  const macdvSeries: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const a = atr26[i];
    macdvSeries.push(a > 0 ? ((ema12[i] - ema26[i]) / a) * 100 : 0);
  }
  const signalSeries = ema(macdvSeries, 9);

  const last = closes.length - 1;
  const v = macdvSeries[last] ?? 0;
  const sig = signalSeries[last] ?? 0;
  const hist = v - sig;
  const prevHist =
    last >= 1 ? (macdvSeries[last - 1] ?? 0) - (signalSeries[last - 1] ?? 0) : 0;

  // 动量生命周期路线图（论文 4.4.5 节）
  let stage: number;
  let stageText: string;
  let stageAction: string;
  if (v > cfg.extreme) {
    stage = 1;
    stageText = `阶段1 动量过热(>+${cfg.extreme})`;
    stageAction = '极度过热（全市场数据 <5%），反转风险最高，论文建议减仓/退出';
  } else if (v > cfg.strong) {
    stage = 2;
    stageText = `阶段2 强势上涨(+${cfg.strong}~+${cfg.extreme})`;
    stageAction = '强势动量区间，趋势持有，跌破信号线注意保护利润';
  } else if (v > 0) {
    stage = 3;
    stageText = `阶段3 动量复苏(0~+${cfg.strong})`;
    stageAction = '动量恢复初期，论文中可介入区间，配合金叉更佳';
  } else if (v > -cfg.strong) {
    stage = 4;
    stageText = `阶段4 动量衰退(-${cfg.strong}~0)`;
    stageAction = '动量转弱，不宜新买入，持仓者考虑离场';
  } else if (v > -cfg.extreme) {
    stage = 5;
    stageText = `阶段5 强势下跌(-${cfg.extreme}~-${cfg.strong})`;
    stageAction = '空头动量强势，回避';
  } else {
    stage = 6;
    stageText = `阶段6 超卖极端(<-${cfg.extreme})`;
    stageAction = '极端超卖，仅适合观察反弹，不接飞刀';
  }

  // 卖出：过热 / 死叉（下穿信号线）/ 动量深度转空
  let sellSignal: MACDVResult['sell_signal'] = 'none';
  let sellReason = 'MACD-V 无卖出信号';
  if (v > cfg.extreme) {
    sellSignal = 'strong';
    sellReason = `MACD-V=${v.toFixed(1)} 超过 +${cfg.extreme} 过热阈值（阶段1），动量极度过热，建议止盈减仓`;
  } else if (v < -cfg.strong) {
    sellSignal = 'strong';
    sellReason = `MACD-V=${v.toFixed(1)} 跌破 -${cfg.strong}（阶段5/6），动量深度走弱，建议退出`;
  } else if (hist < 0 && prevHist >= 0) {
    sellSignal = 'weak';
    sellReason = `MACD-V 刚下穿信号线（死叉，柱 ${prevHist.toFixed(1)}→${hist.toFixed(1)}），动量开始衰减`;
  } else if (hist < 0 && hist < prevHist) {
    sellSignal = 'weak';
    sellReason = `柱状图连续为负且继续放大（${prevHist.toFixed(1)}→${hist.toFixed(1)}），空头动量增强`;
  }

  // 买入：金叉且非深度空头 / 动量复苏
  let buySignal: MACDVResult['buy_signal'] = 'none';
  let buyReason = 'MACD-V 无买入信号';
  if (hist > 0 && prevHist <= 0 && v > -cfg.strong) {
    buySignal = 'good';
    buyReason = `MACD-V 刚上穿信号线（金叉，柱 ${prevHist.toFixed(1)}→${hist.toFixed(1)}），动量转强可买入`;
  } else if (v > 0 && v <= cfg.strong && hist > 0 && hist > prevHist) {
    buySignal = 'good';
    buyReason = `阶段3 动量复苏且柱体放大（${prevHist.toFixed(1)}→${hist.toFixed(1)}），符合论文介入区间`;
  } else if (v > 0 && v <= cfg.strong) {
    buySignal = 'watch';
    buyReason = `MACD-V=${v.toFixed(1)} 处于动量复苏区(0~+${cfg.strong})，可观察`;
  } else if (v > cfg.extreme) {
    buyReason = `MACD-V=${v.toFixed(1)} 过热，不追高`;
  }

  return {
    macdv: +v.toFixed(1),
    signal: +sig.toFixed(1),
    histogram: +hist.toFixed(1),
    prev_histogram: +prevHist.toFixed(1),
    stage,
    stage_text: stageText,
    stage_action: stageAction,
    sell_signal: sellSignal,
    sell_reason: sellReason,
    buy_signal: buySignal,
    buy_reason: buyReason,
  };
}

/* ==================== A 股卖出信号机制（止盈止损之外） ==================== */

export interface SignalItem {
  name: string; // 信号名称
  type: 'stop' | 'tet' | 'macdv' | 'technical' | 'volume' | 'trailing' | 'bagholder';
  triggered: boolean; // 是否触发
  weight: 1 | 2; // 权重：2=强信号，1=弱信号
  detail: string; // 触发条件与当前值说明
}

/** 韭菜50第三信号输入（由路由层 async 拉取后传入，保持本函数纯同步） */
export interface BagholderSignalInput {
  available: boolean;
  in_list: boolean; // 进入韭菜50 Top50 = 卖出信号
  rank?: number | null;
  score?: number | null;
  percentile?: number | null;
  signal_date?: string | null;
  signal_text?: string;
}

export interface SellEvaluation {
  signals: SignalItem[];
  strong_count: number; // 触发的强信号数
  weak_count: number; // 触发的弱信号数
  advice: 'strong_sell' | 'reduce' | 'hold' | 'add';
  advice_text: string;
}

/**
 * 综合卖出信号评估（针对 A 股短线有效，含港股）。
 * @param bars       日 K（升序，≥60 根）
 * @param currentPrice 当前实时价
 * @param highest     持仓期最高价（移动止盈用）
 * @param tet         TET 结果
 * @param macdv       MACD-V 结果
 * @param bagholder   韭菜50第三信号（A股市值前1000池内股票传入；进入Top50=强卖出避雷信号）
 */
export function computeSellSignals(
  bars: DailyBar[],
  currentPrice: number,
  highest: number,
  tet: TETResult,
  macdv: MACDVResult,
  bagholder?: BagholderSignalInput | null,
): SellEvaluation {
  const closes = bars.map((b) => b.close);
  const vols = bars.map((b) => b.vol);
  const last = bars.length - 1;
  const cur = currentPrice > 0 ? currentPrice : closes[last];

  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const rsi14 = rsi(closes, 14);
  const avgVol5 = vols.slice(-6, -1).length > 0
    ? vols.slice(-6, -1).reduce((a, b) => a + b, 0) / vols.slice(-6, -1).length
    : 0;

  const b = bars[last];
  const prev = bars[last - 1];
  const signals: SignalItem[] = [];

  // 1. 移动止盈：从持仓期最高点回撤超 8%
  const drawdown = highest > 0 ? (highest - cur) / highest : 0;
  signals.push({
    name: '移动止盈(回撤8%)',
    type: 'trailing',
    triggered: drawdown >= 0.08,
    weight: 2,
    detail: `持仓期最高 ${highest.toFixed(2)} → 现价 ${cur.toFixed(2)}，回撤 ${(drawdown * 100).toFixed(1)}%（阈值 8%）`,
  });

  // 2. TET 趋势反转
  signals.push({
    name: 'TET趋势反转',
    type: 'tet',
    triggered: tet.sell_signal === 'strong',
    weight: 2,
    detail: tet.sell_reason,
  });

  // 3. TET 短期超买（均值回归风险）
  signals.push({
    name: 'TET情绪超买',
    type: 'tet',
    triggered: tet.sell_signal === 'weak' && tet.emotion_index > 0.5,
    weight: 1,
    detail: `情绪指数 ${tet.emotion_index}（>0.5 超买，短期均值回归风险）`,
  });

  // 4. MACD-V 过热（阈值可自定义）
  signals.push({
    name: 'MACD-V动量过热',
    type: 'macdv',
    triggered: macdv.sell_signal === 'strong' && macdv.macdv > 0,
    weight: 2,
    detail: macdv.sell_reason,
  });

  // 5. MACD-V 死叉/动量衰减
  signals.push({
    name: 'MACD-V死叉',
    type: 'macdv',
    triggered: macdv.sell_signal === 'weak',
    weight: 1,
    detail: macdv.sell_reason,
  });

  // 6. 跌破 MA10 / MA20（短线趋势破坏）
  const belowMa10 = cur < ma10[last];
  const belowMa20 = cur < ma20[last];
  signals.push({
    name: '跌破MA10/MA20',
    type: 'technical',
    triggered: belowMa10,
    weight: belowMa20 ? 2 : 1,
    detail: `现价 ${cur.toFixed(2)}，MA10=${Number.isNaN(ma10[last]) ? '--' : ma10[last].toFixed(2)}，MA20=${Number.isNaN(ma20[last]) ? '--' : ma20[last].toFixed(2)}${belowMa20 ? '（已破MA20，趋势破坏）' : ''}`,
  });

  // 7. MA5 下穿 MA10（均线死叉）
  const crossDown = !Number.isNaN(ma5[last]) && !Number.isNaN(ma10[last]) &&
    !Number.isNaN(ma5[last - 1]) && !Number.isNaN(ma10[last - 1]) &&
    ma5[last - 1] >= ma10[last - 1] && ma5[last] < ma10[last];
  signals.push({
    name: 'MA5/MA10死叉',
    type: 'technical',
    triggered: crossDown,
    weight: 1,
    detail: crossDown ? 'MA5 今日下穿 MA10，短线动能转弱' : `MA5=${ma5[last]?.toFixed(2) ?? '--'} / MA10=${ma10[last]?.toFixed(2) ?? '--'}`,
  });

  // 8. 放量下跌（量价背离，高位出货嫌疑）
  const volRatioToday = avgVol5 > 0 ? b.vol / avgVol5 : 0;
  const heavyDown = volRatioToday >= 2 && b.close < b.open && b.pct_chg < -1;
  signals.push({
    name: '放量下跌(量价背离)',
    type: 'volume',
    triggered: heavyDown,
    weight: 2,
    detail: `今日量比(对5日均量)=${volRatioToday.toFixed(2)}，涨跌 ${b.pct_chg.toFixed(2)}%${heavyDown ? '，放量大跌有出货嫌疑' : ''}`,
  });

  // 9. RSI 超买回落
  const rsiNow = rsi14[last];
  const rsiPrev = rsi14[last - 1];
  const rsiFall = !Number.isNaN(rsiNow) && !Number.isNaN(rsiPrev) && rsiPrev >= 70 && rsiNow < rsiPrev;
  signals.push({
    name: 'RSI超买回落',
    type: 'technical',
    triggered: rsiFall,
    weight: 1,
    detail: `RSI14 ${Number.isNaN(rsiNow) ? '--' : rsiNow.toFixed(1)}（${rsiFall ? `自 ${rsiPrev.toFixed(1)} 超买区回落` : '未触发'}）`,
  });

  // 10. 冲高回落长上影（当日最高大幅冲高后回落收阴）
  if (prev) {
    const body = Math.abs(b.close - b.open);
    const upperShadow = b.high - Math.max(b.close, b.open);
    const longShadow = body > 0 ? upperShadow / body : upperShadow > 0 ? 3 : 0;
    const rejected = longShadow >= 2 && b.close < b.open && b.pct_chg < 3;
    signals.push({
      name: '冲高回落长上影',
      type: 'technical',
      triggered: rejected,
      weight: 1,
      detail: rejected
        ? `上影线达实体 ${longShadow.toFixed(1)} 倍且收阴，上方抛压重`
        : '上影线/实体正常',
    });
  }

  // 11. 韭菜50第三信号（进入Top50=拥挤避雷，强卖出；两态：卖出/无信号）
  if (bagholder) {
    const bhTriggered = bagholder.in_list;
    signals.push({
      name: '韭菜50拥挤避雷',
      type: 'bagholder',
      triggered: bhTriggered,
      weight: 2,
      detail: bagholder.signal_text ?? (bhTriggered ? '进入韭菜50名单' : '未进入韭菜50名单'),
    });
  }

  const triggered = signals.filter((s) => s.triggered);
  const strongCount = triggered.filter((s) => s.weight === 2).length;
  const weakCount = triggered.filter((s) => s.weight === 1).length;

  let advice: SellEvaluation['advice'] = 'hold';
  let adviceText = '继续持有：无明确卖出信号触发';
  if (strongCount >= 2 || (strongCount >= 1 && weakCount >= 2)) {
    advice = 'strong_sell';
    adviceText = `强烈卖出：${strongCount} 个强信号 + ${weakCount} 个弱信号共振（${triggered.map((s) => s.name).join('、')}）`;
  } else if (strongCount === 1 || weakCount >= 2) {
    advice = 'reduce';
    adviceText = `考虑减持：${triggered.map((s) => s.name).join('、')}`;
  } else if (weakCount === 0 && tet.trend_score > 0.3 && macdv.macdv > 0 && macdv.macdv <= 150) {
    advice = 'add';
    adviceText = `信号良好：趋势分 ${tet.trend_score} 向上、MACD-V ${macdv.macdv} 处于健康区间，可继续持有`;
  } else if (weakCount === 1) {
    advice = 'hold';
    adviceText = `继续持有（注意）：${triggered[0].name} 触发，其余信号正常`;
  }

  return { signals, strong_count: strongCount, weak_count: weakCount, advice, advice_text: adviceText };
}

/* ==================== 买入信号（自选股回踩详情用） ==================== */

export interface BuyEvaluation {
  /** 是否可以追涨 */
  chase_ok: boolean;
  chase_reason: string;
  /** 今日主力资金（万元），null 表示无数据（港股） */
  main_inflow: number | null;
  inflow_level: 'large_in' | 'in' | 'out' | 'large_out' | 'unknown';
  inflow_text: string;
  /** 量比（今日量/5日均量） */
  volume_ratio: number;
  /** 综合买入建议 */
  advice: 'buy' | 'wait' | 'avoid';
  advice_text: string;
}

export function computeBuySignals(
  bars: DailyBar[],
  _currentPrice: number,
  tet: TETResult,
  macdv: MACDVResult,
  mainInflowWan: number | null, // 主力净流入（万元）
  isHKMarket = false, // 港股无 Tushare 资金流数据
): BuyEvaluation {
  const vols = bars.map((b) => b.vol);
  const b = bars[bars.length - 1];

  const avgVol5 = vols.slice(-6, -1).length > 0
    ? vols.slice(-6, -1).reduce((a, c) => a + c, 0) / vols.slice(-6, -1).length
    : 0;
  const volumeRatio = avgVol5 > 0 ? +(b.vol / avgVol5).toFixed(2) : 0;

  /* ---- 是否可以追涨 ---- */
  const dayPct = b.pct_chg;
  let chaseOk = true;
  const chaseReasons: string[] = [];
  if (dayPct < 3) {
    chaseOk = false;
    chaseReasons.push(`今日涨 ${dayPct.toFixed(2)}%（<3% 不构成追涨场景，等回踩或企稳再进）`);
  }
  if (dayPct > 7) {
    chaseOk = false;
    chaseReasons.push(`今日已涨 ${dayPct.toFixed(2)}%（>7% 追高风险大）`);
  }
  if (macdv.macdv > 150) {
    chaseOk = false;
    chaseReasons.push(`MACD-V=${macdv.macdv} 过热（>150），动量透支`);
  } else if (chaseOk && macdv.macdv > 100) {
    chaseReasons.push(`MACD-V=${macdv.macdv} 偏高，追涨仅轻仓`);
  }
  if (tet.emotion_index > 0.6) {
    chaseOk = false;
    chaseReasons.push(`情绪指数 ${tet.emotion_index} 超买（>0.6），短期均值回归风险`);
  }
  if (chaseOk && chaseReasons.length === 0) {
    chaseReasons.push(`今日涨 ${dayPct.toFixed(2)}%、MACD-V=${macdv.macdv} 未过热、情绪 ${tet.emotion_index}，可小仓位顺势`);
  }

  /* ---- 资金流入 ---- */
  let inflowLevel: BuyEvaluation['inflow_level'] = 'unknown';
  let inflowText = '暂无资金流向数据';
  if (mainInflowWan !== null) {
    const yi = mainInflowWan / 10000; // 万 → 亿
    if (yi >= 1) {
      inflowLevel = 'large_in';
      inflowText = `主力净流入 ${yi.toFixed(2)} 亿元，大量资金流入`;
    } else if (mainInflowWan > 0) {
      inflowLevel = 'in';
      inflowText = `主力净流入 ${mainInflowWan.toFixed(0)} 万元`;
    } else if (yi <= -1) {
      inflowLevel = 'large_out';
      inflowText = `主力净流出 ${Math.abs(yi).toFixed(2)} 亿元，资金大幅撤离`;
    } else {
      inflowLevel = 'out';
      inflowText = `主力净流出 ${Math.abs(mainInflowWan).toFixed(0)} 万元`;
    }
  } else if (isHKMarket && volumeRatio > 0) {
    // 港股无 Tushare 资金流，用量比近似
    if (volumeRatio >= 2) {
      inflowLevel = 'large_in';
      inflowText = `港股无资金流数据，今日量比 ${volumeRatio} 显著放量（成交活跃，近似大资金参与）`;
    } else if (volumeRatio >= 1.2) {
      inflowLevel = 'in';
      inflowText = `港股无资金流数据，今日量比 ${volumeRatio} 温和放量`;
    } else {
      inflowLevel = 'out';
      inflowText = `港股无资金流数据，今日量比 ${volumeRatio} 缩量`;
    }
  } else {
    inflowText = `资金流数据未更新（Tushare 盘后发布），今日量比 ${volumeRatio}`;
  }

  /* ---- 综合建议 ---- */
  let advice: BuyEvaluation['advice'] = 'wait';
  let adviceText = '等待信号：趋势或时机暂不满足买入条件';
  const tetBuy = tet.buy_signal;
  const macdvBuy = macdv.buy_signal;
  const inflowGood = inflowLevel === 'large_in' || inflowLevel === 'in';
  if ((tetBuy === 'good' && macdvBuy !== 'none') || (macdvBuy === 'good' && tetBuy !== 'none')) {
    advice = 'buy';
    adviceText = `买入信号共振：${tet.buy_reason}；${macdv.buy_reason}${inflowGood ? '；资金面配合' : ''}`;
  } else if (tetBuy === 'good' || macdvBuy === 'good') {
    advice = 'buy';
    adviceText = `单一强信号：${tetBuy === 'good' ? tet.buy_reason : macdv.buy_reason}（另一个指标未确认，建议轻仓试错）`;
  } else if (tetBuy === 'watch' || macdvBuy === 'watch') {
    advice = 'wait';
    adviceText = `观察信号：${tetBuy === 'watch' ? tet.buy_reason : macdv.buy_reason}`;
  } else {
    advice = 'avoid';
    adviceText = `${tet.buy_reason}；${macdv.buy_reason}`;
  }

  return {
    chase_ok: chaseOk,
    chase_reason: chaseReasons.join('；'),
    main_inflow: mainInflowWan,
    inflow_level: inflowLevel,
    inflow_text: inflowText,
    volume_ratio: volumeRatio,
    advice,
    advice_text: adviceText,
  };
}
