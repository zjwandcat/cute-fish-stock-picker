import { useEffect, useState } from 'react';
import { useStockStore } from '@/store/stockStore';
import { useUIStore } from '@/store/uiStore';
import type { StockQuote } from '@/types/stock';
import ModeButton, { ALGO_TIPS } from './ModeButton';

function formatMV(wanYuan: number): string {
  if (!wanYuan || wanYuan === 0) return '--';
  const yi = wanYuan / 10000;
  if (yi >= 10000) return (yi / 10000).toFixed(2) + '万亿';
  return yi.toFixed(2) + '亿';
}

function safeNum(val: number | undefined | null, decimals = 2): string {
  if (val === undefined || val === null || isNaN(val)) return '--';
  return val.toFixed(decimals);
}

/* ============ 排序模式（资金面/基本面/TET/MACD-V） ============ */

type SortMode = 'capital' | 'fund' | 'tet' | 'macdv';

const SORT_MODES: { key: SortMode; label: string; tip: string }[] = [
  { key: 'capital', label: '资金面', tip: ALGO_TIPS.capital },
  { key: 'fund', label: '基本面', tip: ALGO_TIPS.fund },
  { key: 'tet', label: 'TET', tip: ALGO_TIPS.tet },
  { key: 'macdv', label: 'MACD-V', tip: ALGO_TIPS.macdv },
];

interface PoolScores {
  ts_code: string;
  total_score: number | null; // 资金面综合（当前评分方案）
  tech_score: number | null;
  fund_score: number | null; // 基本面
  capital_score: number | null;
  tet_score: number | null;
  macdv_score: number | null;
}

/* ============ 回踩状态（TET+MACD-V 各50%权重判断） ============ */

interface PullbackStatus {
  ts_code: string;
  status: 'ok' | 'no';
  score?: number;
  tet_trend?: number;
  emotion?: number;
  anchored?: number;
  timing?: number;
  macdv?: number;
  stage?: number;
  note?: string;
  /** 韭菜50第三信号两态：'sell'=进入Top50避雷名单 / 'none'=无信号 */
  bagholder?: 'sell' | 'none';
  bagholder_score?: number | null;
  bagholder_percentile?: number | null;
}

export default function StockTable() {
  const stocks = useStockStore((s) => s.stocks) ?? [];
  const selectedStock = useStockStore((s) => s.selectedStock);
  const selectStock = useStockStore((s) => s.selectStock);
  const addStock = useStockStore((s) => s.addStock);
  const removeStock = useStockStore((s) => s.removeStock);

  const { theme } = useUIStore();
  const dark = theme === 'dark';

  const [inputCode, setInputCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 排序模式：最前面=最值得买入，最下面=最值得卖出
  const [sortMode, setSortMode] = useState<SortMode>('capital');
  const [poolScoreMap, setPoolScoreMap] = useState<Record<string, PoolScores>>({});

  // 回踩状态（TET+MACD-V 两态判断，60秒刷新）
  const [pullbackMap, setPullbackMap] = useState<Record<string, PullbackStatus>>({});

  // 全股池四种算法评分（排序用，60秒刷新）
  useEffect(() => {
    const fetchPoolScores = async () => {
      try {
        const res = await fetch('/api/pool-scores');
        const data = await res.json();
        if (data.success) {
          const map: Record<string, PoolScores> = {};
          for (const p of data.data ?? []) map[p.ts_code] = p;
          setPoolScoreMap(map);
        }
      } catch (err) {
        console.error('fetchPoolScores error:', err);
      }
    };
    fetchPoolScores();
    const timer = setInterval(fetchPoolScores, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchPullback = async () => {
      try {
        const res = await fetch('/api/pullback-status');
        const data = await res.json();
        if (data.success) {
          const map: Record<string, PullbackStatus> = {};
          for (const p of data.data ?? []) map[p.ts_code] = p;
          setPullbackMap(map);
        }
      } catch (err) {
        console.error('fetchPullbackStatus error:', err);
      }
    };
    fetchPullback();
    const timer = setInterval(fetchPullback, 60000);
    return () => clearInterval(timer);
  }, []);

  /** 当前排序模式下该股票的评分（无数据返回 undefined，排在末尾） */
  const sortScore = (code: string): number | undefined => {
    const s = poolScoreMap[code];
    if (!s) return undefined;
    const val =
      sortMode === 'capital' ? s.total_score
        : sortMode === 'fund' ? s.fund_score
          : sortMode === 'tet' ? s.tet_score
            : s.macdv_score;
    return val ?? undefined;
  };

  const handleAdd = async () => {
    const code = inputCode.trim();
    if (!code) return;
    setAdding(true);
    setErrorMsg('');
    const result = await addStock(code);
    setAdding(false);
    if (result.success) {
      setInputCode('');
    } else {
      setErrorMsg(result.message || '添加失败');
      setTimeout(() => setErrorMsg(''), 3000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleRemove = async (e: React.MouseEvent, code: string) => {
    e.stopPropagation();
    if (confirm(`确定要从股池中移除该股票吗？`)) {
      await removeStock(code);
    }
  };

  return (
    <div
      className="rounded-3xl overflow-hidden mb-6"
      style={{
        background: dark
          ? 'rgba(255, 255, 255, 0.04)'
          : 'rgba(255, 255, 255, 0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: dark
          ? '0.5px solid rgba(255, 255, 255, 0.06)'
          : '0.5px solid rgba(255, 255, 255, 0.8)',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.04)',
      }}
    >
      {/* 输入框区域 */}
      <div
        className="flex items-center gap-3 px-5 py-4"
        style={{
          borderBottom: dark
            ? '0.5px solid rgba(255, 255, 255, 0.06)'
            : '0.5px solid rgba(0, 0, 0, 0.04)',
          background: dark
            ? 'rgba(255, 255, 255, 0.02)'
            : 'rgba(0, 0, 0, 0.01)',
        }}
      >
        <input
          type="text"
          value={inputCode}
          onChange={(e) => setInputCode(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入股票代码，如 300502 或 300502.SZ"
          className="flex-1 max-w-xs px-4 py-2 rounded-xl text-sm transition-all duration-200 focus:outline-none"
          style={{
            background: dark
              ? 'rgba(255, 255, 255, 0.06)'
              : 'rgba(255, 255, 255, 0.8)',
            border: dark
              ? '0.5px solid rgba(255, 255, 255, 0.1)'
              : '0.5px solid rgba(0, 0, 0, 0.08)',
            color: dark ? '#fff' : '#1c1c1e',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
          }}
          disabled={adding}
        />
        <button
          onClick={handleAdd}
          disabled={adding || !inputCode.trim()}
          className="px-5 py-2 text-sm font-medium rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
          style={{
            background: 'rgba(0, 122, 255, 0.12)',
            color: '#007AFF',
            border: '0.5px solid rgba(0, 122, 255, 0.25)',
          }}
        >
          {adding ? '添加中...' : '添加'}
        </button>
        {errorMsg && (
          <span className="text-xs text-[#FF3B30]">{errorMsg}</span>
        )}
        {/* 排序模式：最前=最值得买入，最后=最值得卖出，悬停查看算法说明 */}
        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          {SORT_MODES.map((m) => (
            <ModeButton
              key={m.key}
              label={m.label}
              tip={m.tip}
              active={sortMode === m.key}
              onClick={() => setSortMode(m.key)}
            />
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr
              className="text-xs"
              style={{
                borderBottom: dark
                  ? '0.5px solid rgba(255, 255, 255, 0.06)'
                  : '0.5px solid rgba(0, 0, 0, 0.04)',
                color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)',
              }}
            >
              <th className="text-left py-3 px-5 font-medium">股票代码</th>
              <th className="text-left py-3 px-5 font-medium">名称</th>
              <th className="text-right py-3 px-5 font-medium">现价</th>
              <th className="text-right py-3 px-5 font-medium">涨跌幅</th>
              <th className="text-center py-3 px-5 font-medium" title="TET+MACD-V 各50%权重综合判断：值得回踩/不入场，悬停标签查看评分">
                回踩状态
              </th>
              <th className="text-center py-3 px-5 font-medium" title="韭菜50第三信号（冷西西指数算法复刻）：追涨热度/换手放大/龙虎榜注意力/特大单流量四因子拥挤度，进入A股市值前1000最易跑输Top50=卖出避雷，两态：卖出/无信号">
                韭菜50
              </th>
              <th className="text-right py-3 px-5 font-medium">PE(TTM)</th>
              <th className="text-right py-3 px-5 font-medium">PB</th>
              <th className="text-right py-3 px-5 font-medium">量比</th>
              <th className="text-right py-3 px-5 font-medium">市值</th>
              <th className="text-center py-3 px-5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {/* 按当前排序模式的评分降序：最值得买入在前，最值得卖出在后；同分按市值降序，无数据排末尾 */}
            {[...stocks]
              .sort((a, b) => {
                const sa = sortScore(a.ts_code);
                const sb = sortScore(b.ts_code);
                if (sa === undefined && sb === undefined) return b.total_mv - a.total_mv;
                if (sa === undefined) return 1;
                if (sb === undefined) return -1;
                if (sb !== sa) return sb - sa;
                return b.total_mv - a.total_mv;
              })
              .map((stock) => (
                <StockRow
                  key={stock.ts_code}
                  stock={stock}
                  pullback={pullbackMap[stock.ts_code]}
                  isSelected={selectedStock === stock.ts_code}
                  onDoubleClick={() => selectStock(stock.ts_code)}
                  onRemove={(e) => handleRemove(e, stock.ts_code)}
                  dark={dark}
                />
              ))}
            {stocks.length === 0 && (
              <tr>
                <td
                  colSpan={11}
                  className="text-center py-12"
                  style={{ color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(60,60,67,0.4)' }}
                >
                  暂无数据，请检查 Tushare Token 配置
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StockRow({
  stock,
  pullback,
  isSelected,
  onDoubleClick,
  onRemove,
  dark,
}: {
  stock: StockQuote;
  pullback?: PullbackStatus;
  isSelected: boolean;
  onDoubleClick: () => void;
  onRemove: (e: React.MouseEvent) => void;
  dark: boolean;
}) {
  const isUp = (stock.change_pct ?? 0) >= 0;
  const changeColor = isUp ? 'text-[#34C759]' : 'text-[#FF3B30]';

  return (
    <tr
      onDoubleClick={onDoubleClick}
      className="cursor-pointer transition-all duration-200"
      style={{
        borderBottom: dark
          ? '0.5px solid rgba(255, 255, 255, 0.04)'
          : '0.5px solid rgba(0, 0, 0, 0.04)',
        background: isSelected
          ? dark
            ? 'rgba(0, 122, 255, 0.08)'
            : 'rgba(0, 122, 255, 0.04)'
          : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.background = dark
            ? 'rgba(255, 255, 255, 0.03)'
            : 'rgba(0, 0, 0, 0.02)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.background = 'transparent';
        }
      }}
    >
      <td
        className="py-3 px-5 font-mono text-xs"
        style={{ color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(60,60,67,0.6)' }}
      >
        {stock.ts_code}
      </td>
      <td
        className="py-3 px-5 font-medium"
        style={{ color: dark ? '#fff' : '#1c1c1e' }}
      >
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {stock.name}
          {stock.market === 'HK' && (
            <span
              className="text-xs px-1.5 py-0.5 rounded border font-mono"
              style={{
                color: '#f0b90b',
                borderColor: 'rgba(240, 185, 11, 0.4)',
                background: 'rgba(240, 185, 11, 0.1)',
              }}
            >
              港股
            </span>
          )}
        </span>
      </td>
      <td className={`py-3 px-5 text-right font-mono ${changeColor}`}>
        {safeNum(stock.price)}
      </td>
      <td className={`py-3 px-5 text-right font-mono ${changeColor}`}>
        {isUp ? '+' : ''}
        {safeNum(stock.change_pct)}%
      </td>
      <td className="py-3 px-5 text-center">
        <span
          className="text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap"
          style={
            pullback?.status === 'ok'
              ? { color: '#34C759', borderColor: 'rgba(52, 199, 89, 0.4)', background: 'rgba(52, 199, 89, 0.1)' }
              : { color: dark ? 'rgba(255,255,255,0.45)' : 'rgba(60,60,67,0.5)', borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)', background: 'transparent' }
          }
          title={pullback ? `综合评分 ${pullback.score ?? '--'}（TET+MACD-V 各50%权重）· TET趋势${pullback.tet_trend ?? '--'} 情绪${pullback.emotion ?? '--'} MACD-V ${pullback.macdv ?? '--'}，双击行查看详情` : '信号计算中，双击行查看详情'}
        >
          {pullback === undefined ? '计算中…' : pullback.status === 'ok' ? '值得回踩' : '不入场'}
        </span>
      </td>
      <td className="py-3 px-5 text-center">
        <span
          className="text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap"
          style={
            pullback?.bagholder === 'sell'
              ? { color: '#FF3B30', borderColor: 'rgba(255, 59, 48, 0.4)', background: 'rgba(255, 59, 48, 0.1)' }
              : { color: dark ? 'rgba(255,255,255,0.45)' : 'rgba(60,60,67,0.5)', borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)', background: 'transparent' }
          }
          title={
            pullback?.bagholder === 'sell'
              ? `进入韭菜50避雷名单：韭菜分 ${(pullback.bagholder_score ?? 0).toFixed(3)}，池内百分位 ${pullback.bagholder_percentile ?? '--'}%，建议卖出`
              : pullback?.bagholder_score !== undefined && pullback.bagholder_score !== null
                ? `未进入韭菜50：韭菜分 ${pullback.bagholder_score.toFixed(3)}，池内百分位 ${pullback.bagholder_percentile ?? '--'}%，无信号`
                : pullback?.bagholder === 'none'
                  ? '未进入韭菜50（或不在A股市值前1000监控池），无信号'
                  : '韭菜50信号计算中'
          }
        >
          {pullback?.bagholder === 'sell' ? '卖出避雷' : pullback?.bagholder === 'none' ? '无信号' : '…'}
        </span>
      </td>
      <td
        className="py-3 px-5 text-right font-mono"
        style={{ color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(60,60,67,0.6)' }}
      >
        {safeNum(stock.pe_ttm)}
      </td>
      <td
        className="py-3 px-5 text-right font-mono"
        style={{ color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(60,60,67,0.6)' }}
      >
        {safeNum(stock.pb)}
      </td>
      <td
        className="py-3 px-5 text-right font-mono"
        style={{ color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(60,60,67,0.6)' }}
      >
        {safeNum(stock.volume_ratio)}
      </td>
      <td
        className="py-3 px-5 text-right font-mono"
        style={{ color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(60,60,67,0.6)' }}
      >
        {formatMV(stock.total_mv)}
      </td>
      <td className="py-3 px-5 text-center">
        <button
          onClick={onRemove}
          className="rounded-lg p-1.5 transition-all duration-200 active:scale-90"
          style={{
            color: '#FF3B30',
            background: 'rgba(255, 59, 48, 0.08)',
          }}
          title="删除"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
