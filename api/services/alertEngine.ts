/**
 * 盯盘提醒引擎。
 *
 * 信号类型:
 *  - dip      跌深提醒(单日跌幅触发)
 *  - bottom   底部建仓信号(量价配合 + 估值低位)
 *  - rebound  反弹启动信号(放量突破均线)
 *  - volume   异动放量(量比 > 2)
 *  - target   到达目标价
 */
import type { StockItem } from './stockPool.js';

// 用户自定义建仓目标价(可在前端覆盖)
export interface UserTargets {
  // 自选股代码 -> { buy: 目标买入价, stop_loss: 止损价 }
  [tsCode: string]: { buy?: number; stop_loss?: number; alert_pct?: number };
}

export type AlertType = 'dip' | 'bottom' | 'rebound' | 'volume' | 'target';
export type AlertPriority = 'high' | 'medium' | 'low';

export interface AlertItem {
  id: string;
  ts_code: string;
  name: string;
  type: AlertType;
  title: string;
  message: string;
  priority: AlertPriority;
  price: number;
  change_pct: number;
  volume_ratio: number;
  pe_ttm: number;
  pb: number;
  suggestion: string;
  created_at: number;
}

export interface StockSnapshot {
  ts_code: string;
  name: string;
  price: number;
  pre_close: number;
  change_pct: number;
  pe_ttm: number;
  pb: number;
  volume_ratio: number;
  turnover_rate: number;
  total_mv: number;
  high: number;
  low: number;
}

const alertHistory: AlertItem[] = [];
const MAX_HISTORY = 200;
let idCounter = 0;

const PRIORITY_WEIGHT: Record<AlertPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * 生成告警的唯一 ID。
 */
function genId(): string {
  idCounter += 1;
  return `alert_${Date.now()}_${idCounter}`;
}

/**
 * 添加一条告警并保留历史(最多 MAX_HISTORY 条)。
 */
function pushAlert(alert: Omit<AlertItem, 'id' | 'created_at'>): AlertItem {
  const item: AlertItem = {
    ...alert,
    id: genId(),
    created_at: Date.now(),
  };
  alertHistory.unshift(item);
  if (alertHistory.length > MAX_HISTORY) {
    alertHistory.length = MAX_HISTORY;
  }
  return item;
}

/**
 * 构造基础告警字段(减少重复代码)。
 */
function buildBaseAlert(snap: StockSnapshot, type: AlertType): Omit<AlertItem, 'id' | 'created_at' | 'title' | 'message' | 'priority' | 'suggestion'> {
  return {
    ts_code: snap.ts_code,
    name: snap.name,
    type,
    price: snap.price,
    change_pct: snap.change_pct,
    volume_ratio: snap.volume_ratio,
    pe_ttm: snap.pe_ttm,
    pb: snap.pb,
  };
}

/**
 * 核心分析函数:对一只股票生成告警。
 */
export function analyzeStock(snap: StockSnapshot, targets: UserTargets = {}): AlertItem[] {
  const newAlerts: Omit<AlertItem, 'id' | 'created_at'>[] = [];
  const userTarget = targets[snap.ts_code] ?? {};
  const changePct = snap.change_pct;
  const volRatio = snap.volume_ratio;
  const base = buildBaseAlert(snap, 'dip');

  // 1. 跌深提醒:单日跌幅 >= 4%
  if (changePct <= -4) {
    newAlerts.push({
      ...base,
      type: 'dip',
      title: `📉 ${snap.name} 大跌`,
      message: `单日跌幅 ${changePct.toFixed(2)}%,现价 ${snap.price.toFixed(2)}`,
      priority: changePct <= -6 ? 'high' : 'medium',
      suggestion: changePct <= -6
        ? '考虑分批建仓第 1 档'
        : '关注是否止跌,等待第二根 K 线确认',
    });
  }

  // 2. 底部建仓信号:低位 + 低估 + 缩量
  if (
    changePct >= -3 && changePct <= 1 &&
    volRatio > 0 && volRatio < 0.8 &&
    snap.pe_ttm > 0 && snap.pe_ttm < 30 &&
    snap.pb > 0 && snap.pb < 4
  ) {
    newAlerts.push({
      ...base,
      type: 'bottom',
      title: `💎 ${snap.name} 底部信号`,
      message: `缩量企稳,PE ${snap.pe_ttm.toFixed(1)},PB ${snap.pb.toFixed(2)}`,
      priority: 'high',
      suggestion: `建议建仓:分 3 次(${(snap.price * 0.97).toFixed(2)}/${(snap.price * 0.95).toFixed(2)}/${(snap.price * 0.93).toFixed(2)})`,
    });
  }

  // 3. 反弹启动信号:放量上涨 + 突破
  if (changePct >= 3 && volRatio >= 1.5) {
    newAlerts.push({
      ...base,
      type: 'rebound',
      title: `🚀 ${snap.name} 放量反弹`,
      message: `涨 ${changePct.toFixed(2)}%,量比 ${volRatio.toFixed(2)}`,
      priority: 'medium',
      suggestion: '强势启动,已有仓位可继续持有;空仓者慎追高',
    });
  }

  // 4. 异动放量:量比 > 2 但涨跌幅不大(可能是洗盘或吸筹)
  if (volRatio >= 2 && Math.abs(changePct) < 2) {
    newAlerts.push({
      ...base,
      type: 'volume',
      title: `⚡ ${snap.name} 异动放量`,
      message: `量比 ${volRatio.toFixed(2)},但价格 ${changePct >= 0 ? '微涨' : '微跌'} ${Math.abs(changePct).toFixed(2)}%`,
      priority: 'medium',
      suggestion: '观察资金意图,可能为建仓/出货信号',
    });
  }

  // 5. 到达用户目标价
  if (userTarget.buy && snap.price <= userTarget.buy) {
    newAlerts.push({
      ...base,
      type: 'target',
      title: `🎯 ${snap.name} 到达目标买入价`,
      message: `现价 ${snap.price.toFixed(2)} ≤ 目标价 ${userTarget.buy.toFixed(2)}`,
      priority: 'high',
      suggestion: '可按计划分批建仓',
    });
  }

  if (userTarget.stop_loss && snap.price <= userTarget.stop_loss) {
    newAlerts.push({
      ...base,
      type: 'target',
      title: `🛑 ${snap.name} 触及止损价`,
      message: `现价 ${snap.price.toFixed(2)} ≤ 止损价 ${userTarget.stop_loss.toFixed(2)}`,
      priority: 'high',
      suggestion: '建议止损出局,避免扩大亏损',
    });
  }

  return newAlerts.map((a) => pushAlert(a));
}

export function getAlerts(limit = 50): AlertItem[] {
  return alertHistory.slice(0, limit);
}

export function clearAlerts(): void {
  alertHistory.length = 0;
}

/**
 * 批量分析所有自选股。
 * 按优先级 + 时间排序返回。
 */
export function analyzeAll(snapshots: StockSnapshot[], targets: UserTargets = {}): AlertItem[] {
  const out: AlertItem[] = [];
  for (const s of snapshots) {
    out.push(...analyzeStock(s, targets));
  }
  return out.sort((a, b) => {
    if (PRIORITY_WEIGHT[a.priority] !== PRIORITY_WEIGHT[b.priority]) {
      return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    }
    return b.created_at - a.created_at;
  });
}

// StockItem 仅用于类型约束,确保 STOCK_POOL 与本模块解耦
export type { StockItem };
