import { useEffect, useState } from 'react';
import { ShieldAlert, ChevronDown } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';

/**
 * 韭菜50避雷名单（冷西西 bagholder50 指数算法复刻，第三信号）
 * 四因子（追涨热度/换手放大/龙虎榜注意力/特大单流量）横截面百分位等权合成，
 * 选出 A 股市值前 1000 中最易跑输市场的 Top50，按韭菜分从高到低展示。
 * 信号只有两态：进入名单 = 卖出（避雷），未进入 = 无信号。
 */

interface BagholderComponentFE {
  rank: number;
  ts_code: string;
  name: string;
  score: number;
  factors: {
    price_chase_20: number;
    turn_spike: number;
    toplist_cnt_20: number;
    elg_net_20: number;
  };
}

interface BagholderResultFE {
  signal_date: string;
  entry_date: string | null;
  generated_at: string;
  universe_count: number;
  valid_count: number;
  top50: BagholderComponentFE[];
}

function fmtDate(d: string | null): string {
  if (!d || d.length !== 8) return '--';
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** 因子百分位迷你条（0-100，≥90 高亮警示） */
function FactorBar({ pct, dark }: { pct: number; dark: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="h-1.5 w-14 rounded-full overflow-hidden"
        style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, pct * 100)}%`,
            background: pct >= 0.9 ? 'linear-gradient(90deg, #FF3B30, #FF9F0A)' : 'linear-gradient(90deg, #007AFF, #5AC8FA)',
          }}
        />
      </div>
      <span
        className="font-mono text-xs"
        style={{ color: pct >= 0.9 ? '#FF3B30' : dark ? 'rgba(255,255,255,0.6)' : 'rgba(60,60,67,0.6)' }}
      >
        {(pct * 100).toFixed(0)}
      </span>
    </div>
  );
}

export default function Bagholder50Section() {
  const { theme } = useUIStore();
  const dark = theme === 'dark';

  const [data, setData] = useState<BagholderResultFE | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchList = async () => {
      try {
        const res = await fetch('/api/bagholder50');
        const json = await res.json();
        if (cancelled) return;
        if (json.success && json.data) {
          setData(json.data);
          setError('');
        } else {
          setError(json.message || '韭菜50名单生成失败');
        }
      } catch {
        if (!cancelled) setError('韭菜50名单加载失败');
      }
    };
    fetchList();
    const timer = setInterval(fetchList, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const panelBg = dark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.6)';
  const border = dark ? '0.5px solid rgba(255, 255, 255, 0.06)' : '0.5px solid rgba(255, 255, 255, 0.8)';
  const textPrimary = dark ? '#fff' : '#1c1c1e';
  const textSecondary = dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)';

  return (
    <div
      className="rounded-3xl overflow-hidden mb-6"
      style={{
        background: panelBg,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border,
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.04)',
      }}
    >
      {/* 头部：标题 + 信号日 + 折叠按钮 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left transition-colors"
        style={{ background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' }}
      >
        <span
          className="flex items-center justify-center w-8 h-8 rounded-2xl shrink-0"
          style={{ background: 'rgba(255, 59, 48, 0.12)' }}
        >
          <ShieldAlert size={16} className="text-[#FF3B30]" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold" style={{ color: textPrimary }}>
              韭菜50避雷名单 · 第三信号
            </span>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ color: '#FF3B30', background: 'rgba(255, 59, 48, 0.1)', border: '0.5px solid rgba(255, 59, 48, 0.3)' }}
            >
              进入名单 = 卖出
            </span>
          </div>
          <div className="text-xs mt-0.5" style={{ color: textSecondary }}>
            {data
              ? `${fmtDate(data.signal_date)} 收盘因子 · 次日开盘生效 · A股市值前1000（四因子齐备 ${data.valid_count} 只）`
              : error
                ? '名单不可用'
                : '名单加载中…'}
          </div>
        </div>
        <ChevronDown
          size={16}
          className="shrink-0 transition-transform duration-300"
          style={{ color: textSecondary, transform: expanded ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {/* 失败提示（fail-closed：数据未齐备不降级） */}
      {error && (
        <div
          className="mx-5 mb-4 rounded-2xl px-4 py-3 text-xs"
          style={{ background: 'rgba(255, 149, 0, 0.08)', border: '0.5px solid rgba(255, 149, 0, 0.3)', color: '#FF9500' }}
        >
          {error}。首次使用需全量拉取约220次数据（市值前1000 × 22/20日窗口），之后每日仅增量更新。
        </div>
      )}

      {/* Top50 表格（默认收起，点击展开；默认展示前10名，展开后全部50只） */}
      {expanded && data && (
        <div className="overflow-x-auto" style={{ borderTop: dark ? '0.5px solid rgba(255,255,255,0.06)' : '0.5px solid rgba(0,0,0,0.04)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs"
                style={{ color: textSecondary, borderBottom: dark ? '0.5px solid rgba(255,255,255,0.06)' : '0.5px solid rgba(0,0,0,0.04)' }}
              >
                <th className="text-left py-3 px-5 font-medium">#</th>
                <th className="text-left py-3 px-3 font-medium">代码</th>
                <th className="text-left py-3 px-3 font-medium">名称</th>
                <th className="text-right py-3 px-3 font-medium">韭菜分</th>
                <th className="text-left py-3 px-3 font-medium" title="20日涨幅排名+涨停触及排名均值">
                  追涨热度
                </th>
                <th className="text-left py-3 px-3 font-medium" title="20日均换手/120日均换手">
                  换手放大
                </th>
                <th className="text-left py-3 px-3 font-medium" title="近20日龙虎榜上榜次数">
                  龙虎榜
                </th>
                <th className="text-left py-3 px-3 font-medium" title="近20日特大单净额/分类成交额">
                  特大单
                </th>
              </tr>
            </thead>
            <tbody>
              {data.top50.map((c) => (
                <tr key={c.ts_code} style={{ borderBottom: dark ? '0.5px solid rgba(255,255,255,0.04)' : '0.5px solid rgba(0,0,0,0.04)' }}>
                  <td
                    className="py-2.5 px-5 font-mono text-xs"
                    style={{ color: c.rank <= 10 ? '#FF3B30' : textSecondary }}
                  >
                    {c.rank}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-xs" style={{ color: textSecondary }}>
                    {c.ts_code}
                  </td>
                  <td className="py-2.5 px-3 font-medium" style={{ color: textPrimary }}>
                    {c.name}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold" style={{ color: c.rank <= 10 ? '#FF3B30' : textPrimary }}>
                    {c.score.toFixed(3)}
                  </td>
                  <td className="py-2.5 px-3"><FactorBar pct={c.factors.price_chase_20} dark={dark} /></td>
                  <td className="py-2.5 px-3"><FactorBar pct={c.factors.turn_spike} dark={dark} /></td>
                  <td className="py-2.5 px-3"><FactorBar pct={c.factors.toplist_cnt_20} dark={dark} /></td>
                  <td className="py-2.5 px-3"><FactorBar pct={c.factors.elg_net_20} dark={dark} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 text-xs" style={{ color: textSecondary }}>
            规则：追涨热度、换手放大、龙虎榜注意力、特大单流量四因子横截面百分位等权合成（四项缺一不可），
            选出市值前1000中最易跑输的Top50；原版理论组合为次日开盘等权进入、每只2%权重，此处仅作避雷参考，不构成实盘账本。
            名单由本地缓存数据计算，首次全量构建后每日增量更新；资金流或龙虎榜整表未到时停止生成（fail-closed，不自动降级）。
          </div>
        </div>
      )}
    </div>
  );
}
