import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useStockStore } from '@/store/stockStore';

interface Holding {
  ts_code: string;
  name: string;
  buy_price: number;
  buy_date: string;
  shares: number;
  position_pct: number;
  stop_loss: number;
  take_profit: number;
  strategy: string;
  status: string;
  note?: string;
}

interface TETResult {
  trend_score: number;
  emotion_index: number;
  anchored_trend: number;
  timing: number;
  valid_votes: number;
  bars_count: number;
  sell_signal: 'none' | 'weak' | 'strong';
  sell_reason: string;
  buy_signal: 'none' | 'watch' | 'good';
  buy_reason: string;
}

interface MACDVResult {
  macdv: number;
  signal: number;
  histogram: number;
  prev_histogram: number;
  stage: number;
  stage_text: string;
  stage_action: string;
  sell_signal: 'none' | 'weak' | 'strong';
  sell_reason: string;
  buy_signal: 'none' | 'watch' | 'good';
  buy_reason: string;
}

interface SignalItem {
  name: string;
  type: 'stop' | 'tet' | 'macdv' | 'technical' | 'volume' | 'trailing';
  triggered: boolean;
  weight: 1 | 2;
  detail: string;
}

interface SellEvaluation {
  signals: SignalItem[];
  strong_count: number;
  weak_count: number;
  advice: 'strong_sell' | 'reduce' | 'hold' | 'add';
  advice_text: string;
}

interface OverallResult {
  verdict: 'buy' | 'sell' | 'neutral';
  text: string;
}

interface HoldingSignal {
  ts_code: string;
  name: string;
  price: number;
  pct_chg: number;
  market: 'A' | 'HK';
  highest?: number;
  buy_date?: string;
  overall?: OverallResult;
  tet?: TETResult;
  macdv?: MACDVResult;
  sell?: SellEvaluation;
  error?: string;
}

interface SearchItem {
  ts_code: string;
  name: string;
  market: 'A' | 'HK';
}

const VERDICT_STYLE: Record<OverallResult['verdict'], { color: string; text: string }> = {
  buy: { color: '#34C759', text: '买入' },
  sell: { color: '#FF3B30', text: '卖出' },
  neutral: { color: '#f0b90b', text: '不动' },
};

export default function HoldingsSection() {
  const { theme } = useUIStore();
  const selectStock = useStockStore((s) => s.selectStock);
  const dark = theme === 'dark';
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>('');
  const [signals, setSignals] = useState<Record<string, HoldingSignal>>({});
  const [loading, setLoading] = useState(false);

  // 添加持仓输入栏
  const [inputCode, setInputCode] = useState('');
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [addError, setAddError] = useState('');

  // 行内编辑（股数/买入价）
  const [drafts, setDrafts] = useState<Record<string, { shares?: string; buy_price?: string }>>({});
  const [editingKeys, setEditingKeys] = useState<Set<string>>(new Set());

  // MACD-V 阈值设置
  const [showSettings, setShowSettings] = useState(false);
  const [cfgStrong, setCfgStrong] = useState('');
  const [cfgExtreme, setCfgExtreme] = useState('');
  const [cfgMsg, setCfgMsg] = useState('');
  const macdvCfgRef = useRef<{ strong: number; extreme: number } | null>(null);

  const fetchHoldings = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/holdings');
      const data = await res.json();
      if (data.success) {
        // 编辑中的字段不被定时刷新覆盖
        setHoldings(
          (data.holdings ?? []).map((h: Holding) => {
            const d = drafts[h.ts_code];
            if (editingKeys.has(`${h.ts_code}:shares`) && d?.shares !== undefined) {
              return { ...h, shares: Number(d.shares) || h.shares };
            }
            if (editingKeys.has(`${h.ts_code}:buy_price`) && d?.buy_price !== undefined) {
              return { ...h, buy_price: Number(d.buy_price) || h.buy_price };
            }
            return h;
          }),
        );
        setUpdatedAt(data.updated_at ?? '');
      }
    } catch (err) {
      console.error('fetchHoldings error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSignals = async () => {
    try {
      const res = await fetch('/api/holdings/signals');
      const data = await res.json();
      if (data.success) {
        const map: Record<string, HoldingSignal> = {};
        for (const s of data.data ?? []) map[s.ts_code] = s;
        setSignals(map);
        if (data.macdv_config && !macdvCfgRef.current) {
          macdvCfgRef.current = data.macdv_config;
        }
      }
    } catch (err) {
      console.error('fetchSignals error:', err);
    }
  };

  useEffect(() => {
    fetchHoldings();
    fetchSignals();
    const timer = setInterval(() => {
      fetchHoldings();
      fetchSignals();
    }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ============ 添加/删除/保存持仓 ============ */

  const addHolding = async (item: SearchItem) => {
    const today = new Date().toISOString().slice(0, 10);
    const holding: Holding = {
      ts_code: item.ts_code,
      name: item.name,
      buy_price: 0,
      buy_date: today,
      shares: 0,
      position_pct: 0,
      stop_loss: 0,
      take_profit: 0,
      strategy: '手动添加',
      status: 'holding',
    };
    try {
      const res = await fetch('/api/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', holding }),
      });
      const data = await res.json();
      if (data.success) {
        setInputCode('');
        setSearchResults([]);
        setAddError('');
        fetchHoldings();
        fetchSignals();
      } else {
        setAddError(data.message || '添加失败');
      }
    } catch {
      setAddError('网络错误');
    }
  };

  const removeHolding = async (tsCode: string) => {
    if (!confirm('确定从我的持仓中删除该股票吗？')) return;
    try {
      await fetch('/api/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove',
          holding: { ts_code: tsCode, name: '', buy_price: 0, buy_date: '', shares: 0, position_pct: 0, stop_loss: 0, take_profit: 0, strategy: '', status: '' },
        }),
      });
      fetchHoldings();
      fetchSignals();
    } catch (err) {
      console.error('removeHolding error:', err);
    }
  };

  const commitField = async (h: Holding, field: 'shares' | 'buy_price', raw: string) => {
    const key = `${h.ts_code}:${field}`;
    setEditingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    const val = Number(raw);
    if (!Number.isFinite(val) || val < 0 || val === h[field]) {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[h.ts_code];
        return next;
      });
      return;
    }
    // 本地即时生效 + 持久化
    setHoldings((prev) => prev.map((x) => (x.ts_code === h.ts_code ? { ...x, [field]: val } : x)));
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[h.ts_code];
      return next;
    });
    try {
      await fetch('/api/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          holding: { ...h, [field]: val },
        }),
      });
    } catch (err) {
      console.error('保存持仓失败:', err);
    }
  };

  /* ============ 搜索 ============ */

  const handleSearchEnter = async () => {
    const q = inputCode.trim();
    if (!q) return;
    setSearching(true);
    setAddError('');
    setSearchResults([]);
    try {
      const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const results: SearchItem[] = data.data ?? [];
      if (results.length === 0) {
        setAddError(`未找到"${q}"对应的股票`);
      } else if (results.length === 1) {
        await addHolding(results[0]);
      } else {
        setSearchResults(results);
      }
    } catch {
      setAddError('搜索失败，请重试');
    } finally {
      setSearching(false);
    }
  };

  /* ============ MACD-V 阈值 ============ */

  const openSettings = () => {
    const cfg = macdvCfgRef.current;
    setCfgStrong(String(cfg?.strong ?? 50));
    setCfgExtreme(String(cfg?.extreme ?? 150));
    setCfgMsg('');
    setShowSettings(true);
  };

  const saveSettings = async () => {
    const strong = Number(cfgStrong);
    const extreme = Number(cfgExtreme);
    if (!Number.isFinite(strong) || !Number.isFinite(extreme) || strong < 5 || extreme <= strong || extreme > 500) {
      setCfgMsg('无效：需 5 ≤ 强势阈值 < 极端阈值 ≤ 500');
      return;
    }
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ macdv: { strong, extreme } }),
      });
      const data = await res.json();
      if (data.success) {
        macdvCfgRef.current = { strong, extreme };
        setShowSettings(false);
        fetchSignals();
      } else {
        setCfgMsg(data.message || '保存失败');
      }
    } catch {
      setCfgMsg('网络错误');
    }
  };

  /* ============ 渲染 ============ */

  const cardBg = dark ? 'bg-[#161b22]' : 'bg-white';
  const border = dark ? 'border-[#30363d]' : 'border-[#e5e7eb]';
  const textPrimary = dark ? 'text-white' : 'text-[#1f2937]';
  const textSecondary = dark ? 'text-[#8b949e]' : 'text-[#6b7280]';
  const secondaryColor = dark ? '#8b949e' : '#6b7280';
  const inputBg = dark ? 'bg-[#0d1117] border-[#30363d]' : 'bg-[#f9fafb] border-[#d1d5db]';

  const updatedText = updatedAt
    ? new Date(updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--';

  const calcPnl = (h: Holding): { pnl: number; pnlPct: number; currentPrice: number } => {
    const currentPrice = signals[h.ts_code]?.price ?? h.buy_price;
    const pnl = (currentPrice - h.buy_price) * h.shares;
    const pnlPct = h.buy_price > 0 ? ((currentPrice - h.buy_price) / h.buy_price) * 100 : 0;
    return { pnl, pnlPct, currentPrice };
  };

  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[#00d4aa] text-lg">◆</span>
        <h2 className={`text-base font-bold ${textPrimary}`} style={{ fontFamily: '"Noto Sans SC", sans-serif' }}>
          我的持仓
        </h2>
        <span className={`text-xs ${textSecondary} ml-2`}>
          {loading ? '更新中...' : `更新于 ${updatedText}`}
        </span>
        <button
          onClick={openSettings}
          className={`ml-auto text-xs px-2 py-1 rounded border ${border} ${textSecondary} hover:border-[#f0b90b]/50 hover:text-[#f0b90b] transition-colors`}
          title="自定义 MACD-V 卖出/买入信号阈值"
        >
          ⚙ MACD-V阈值
        </button>
        <button
          onClick={() => {
            fetchHoldings();
            fetchSignals();
          }}
          className={`text-xs px-2 py-1 rounded border ${border} ${textSecondary} hover:border-[#00d4aa]/40 hover:text-[#00d4aa] transition-colors`}
        >
          刷新
        </button>
      </div>

      {/* MACD-V 阈值设置面板 */}
      {showSettings && (
        <div className={`mb-3 p-3 rounded-lg border ${border} ${cardBg} flex flex-wrap items-center gap-3`}>
          <span className={`text-xs ${textSecondary}`}>
            MACD-V 动量生命周期阈值（{(macdvCfgRef.current?.strong ?? 50)}/{macdvCfgRef.current?.extreme ?? 150}），调低更早触发卖出，调高更容忍上涨：
          </span>
          <label className={`text-xs ${textSecondary} flex items-center gap-1`}>
            强势阈值
            <input
              type="number"
              value={cfgStrong}
              onChange={(e) => setCfgStrong(e.target.value)}
              className={`w-20 px-2 py-1 text-xs rounded border ${inputBg} ${textPrimary}`}
            />
          </label>
          <label className={`text-xs ${textSecondary} flex items-center gap-1`}>
            极端阈值
            <input
              type="number"
              value={cfgExtreme}
              onChange={(e) => setCfgExtreme(e.target.value)}
              className={`w-20 px-2 py-1 text-xs rounded border ${inputBg} ${textPrimary}`}
            />
          </label>
          <button onClick={saveSettings} className="text-xs px-3 py-1 rounded bg-[#f0b90b]/20 text-[#f0b90b] border border-[#f0b90b]/40 hover:bg-[#f0b90b]/30">
            保存
          </button>
          <button
            onClick={() => {
              setCfgStrong('50');
              setCfgExtreme('150');
            }}
            className={`text-xs px-2 py-1 rounded border ${border} ${textSecondary}`}
          >
            恢复默认
          </button>
          {cfgMsg && <span className="text-xs text-[#ff4757]">{cfgMsg}</span>}
        </div>
      )}

      {/* 添加持仓输入栏 */}
      <div className="relative mb-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputCode}
            onChange={(e) => {
              setInputCode(e.target.value);
              setSearchResults([]);
              setAddError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSearchEnter();
              }
            }}
            placeholder="输入股票名称或代码，回车添加到我的持仓（如：云南白药 / 000538 / 腾讯控股 / 00700）"
            className={`flex-1 px-3 py-2 text-sm rounded-lg border ${inputBg} ${textPrimary} focus:outline-none focus:border-[#00d4aa]/50`}
            disabled={searching}
          />
          <button
            onClick={handleSearchEnter}
            disabled={searching || !inputCode.trim()}
            className="text-xs px-3 py-2 rounded-lg bg-[#00d4aa]/15 text-[#00d4aa] border border-[#00d4aa]/40 hover:bg-[#00d4aa]/25 disabled:opacity-40"
          >
            {searching ? '搜索中...' : '添加持仓'}
          </button>
          {addError && <span className="text-xs text-[#ff4757] whitespace-nowrap">{addError}</span>}
        </div>
        {searchResults.length > 0 && (
          <div className={`absolute z-20 left-0 right-32 mt-1 rounded-lg border ${border} ${cardBg} shadow-lg overflow-hidden`}>
            {searchResults.map((r) => (
              <button
                key={r.ts_code}
                onClick={() => addHolding(r)}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm ${textPrimary} hover:bg-[#00d4aa]/10 transition-colors`}
              >
                <span className="font-medium">
                  {r.name}
                  {r.market === 'HK' && (
                    <span className="ml-1 text-xs px-1 py-0.5 rounded bg-[#3b82f6]/15 text-[#3b82f6] border border-[#3b82f6]/30">港股</span>
                  )}
                </span>
                <span className={`text-xs font-mono ${textSecondary}`}>{r.ts_code}</span>
              </button>
            ))}
            <div className={`px-3 py-1 text-xs ${textSecondary} border-t ${border}`}>找到多个匹配，点击选择要添加的股票</div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className={`w-full text-sm border ${border} ${cardBg} rounded-lg overflow-hidden`}>
          <thead>
            <tr className={dark ? 'bg-[#21262d]' : 'bg-[#f9fafb]'}>
              <th className={`text-left px-3 py-2 font-medium ${textSecondary}`}>股票</th>
              <th className={`text-right px-3 py-2 font-medium ${textSecondary}`}>买入价 ✎</th>
              <th className={`text-right px-3 py-2 font-medium ${textSecondary}`}>现价</th>
              <th className={`text-right px-3 py-2 font-medium ${textSecondary}`}>涨跌</th>
              <th className={`text-right px-3 py-2 font-medium ${textSecondary}`}>股数 ✎</th>
              <th className={`text-right px-3 py-2 font-medium ${textSecondary}`}>盈亏</th>
              <th className={`text-center px-3 py-2 font-medium ${textSecondary}`}>建议</th>
              <th className={`text-right px-3 py-2 font-medium ${textSecondary}`}>止损位</th>
              <th className={`text-right px-3 py-2 font-medium ${textSecondary}`}>止盈位</th>
              <th className={`text-center px-3 py-2 font-medium ${textSecondary}`}>状态</th>
              <th className={`text-center px-3 py-2 font-medium ${textSecondary}`}>操作</th>
            </tr>
          </thead>
          <tbody>
            {holdings.length === 0 && (
              <tr>
                <td colSpan={11} className={`px-3 py-6 text-center ${textSecondary}`}>
                  暂无持仓，在上方输入股票名称或代码后回车添加
                </td>
              </tr>
            )}
            {holdings.map((h) => {
              const sig = signals[h.ts_code];
              const { pnl, pnlPct, currentPrice } = calcPnl(h);
              const pnlColor = pnl > 0 ? '#ff4757' : pnl < 0 ? '#00d4aa' : secondaryColor;
              const priceColor = sig?.pct_chg > 0 ? '#ff4757' : sig?.pct_chg < 0 ? '#00d4aa' : secondaryColor;
              const statusColor = h.status === 'holding' ? '#00d4aa' : h.status === 'stopped' ? '#ff4757' : '#f0b90b';
              const stopWarning = h.stop_loss > 0 && currentPrice > 0 && (currentPrice - h.stop_loss) / currentPrice < 0.02;
              const isHK = sig?.market === 'HK' || h.ts_code.endsWith('.HK');
              const currencyLabel = isHK ? 'HK$' : '¥';
              const verdict = sig?.overall?.verdict;
              const verdictStyle = verdict ? VERDICT_STYLE[verdict] : null;
              return (
                <tr
                  key={h.ts_code}
                  className={`border-t ${border} cursor-pointer ${stopWarning ? 'bg-[#ff4757]/5' : ''}`}
                  onDoubleClick={() => selectStock(h.ts_code)}
                  title="双击查看详细信息（TET+MACD-V综合评估、卖出信号系统）"
                >
                  <td className={`px-3 py-2 ${textPrimary}`}>
                    <div className="font-bold">
                      {h.name}
                      {isHK && (
                        <span className="ml-1 text-xs px-1 py-0.5 rounded bg-[#3b82f6]/15 text-[#3b82f6] border border-[#3b82f6]/30">港股</span>
                      )}
                      {stopWarning && <span className="ml-2 text-xs text-[#ff4757]">⚠ 接近止损</span>}
                    </div>
                    <div className={`text-xs font-mono ${textSecondary}`}>{h.ts_code}</div>
                  </td>
                  <td className="px-2 py-1 text-right" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={drafts[h.ts_code]?.buy_price ?? (h.buy_price > 0 ? h.buy_price : '')}
                      placeholder={currentPrice > 0 ? `现价${currentPrice.toFixed(2)}` : '买入价'}
                      onFocus={() => setEditingKeys((p) => new Set(p).add(`${h.ts_code}:buy_price`))}
                      onChange={(e) => setDrafts((p) => ({ ...p, [h.ts_code]: { ...p[h.ts_code], buy_price: e.target.value } }))}
                      onBlur={(e) => commitField(h, 'buy_price', e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      className={`w-20 px-1 py-0.5 text-right font-mono text-sm rounded border ${inputBg} ${textPrimary} focus:outline-none focus:border-[#00d4aa]/50`}
                    />
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${textPrimary}`}>
                    {currentPrice > 0 ? `${currencyLabel}${currentPrice.toFixed(2)}` : '--'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: priceColor }}>
                    {sig && sig.pct_chg !== undefined ? `${sig.pct_chg > 0 ? '+' : ''}${sig.pct_chg.toFixed(2)}%` : '--'}
                  </td>
                  <td className="px-2 py-1 text-right" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    <input
                      type="number"
                      step="100"
                      min="0"
                      value={drafts[h.ts_code]?.shares ?? (h.shares > 0 ? h.shares : '')}
                      placeholder="股数"
                      onFocus={() => setEditingKeys((p) => new Set(p).add(`${h.ts_code}:shares`))}
                      onChange={(e) => setDrafts((p) => ({ ...p, [h.ts_code]: { ...p[h.ts_code], shares: e.target.value } }))}
                      onBlur={(e) => commitField(h, 'shares', e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      className={`w-24 px-1 py-0.5 text-right font-mono text-sm rounded border ${inputBg} ${textPrimary} focus:outline-none focus:border-[#00d4aa]/50`}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: pnlColor }}>
                    {h.buy_price > 0 && h.shares > 0 ? (
                      <>
                        {pnl > 0 ? '+' : ''}
                        {pnl.toFixed(2)}
                        <div className={`text-xs ${textSecondary}`}>
                          {pnlPct > 0 ? '+' : ''}
                          {pnlPct.toFixed(2)}%
                        </div>
                      </>
                    ) : (
                      '--'
                    )}
                  </td>
                  <td className="px-3 py-2 text-center" title={sig?.overall?.text ?? ''}>
                    {verdictStyle ? (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap"
                        style={{ color: verdictStyle.color, borderColor: `${verdictStyle.color}40`, backgroundColor: `${verdictStyle.color}15` }}
                      >
                        {verdictStyle.text}
                        {sig?.sell ? ` (${sig.sell.strong_count}强${sig.sell.weak_count > 0 ? `/${sig.sell.weak_count}弱` : ''})` : ''}
                      </span>
                    ) : (
                      <span className={`text-xs ${textSecondary}`}>{sig?.error ?? '计算中'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[#ff4757]">
                    {h.stop_loss > 0 ? h.stop_loss.toFixed(2) : '--'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[#00d4aa]">
                    {h.take_profit > 0 ? h.take_profit.toFixed(2) : '--'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap"
                      style={{ color: statusColor, borderColor: `${statusColor}40`, backgroundColor: `${statusColor}15` }}
                    >
                      {h.status === 'holding' ? '持仓中' : h.status === 'stopped' ? '已止损' : '观察'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => selectStock(h.ts_code)}
                      className={`text-xs px-2 py-1 rounded border ${border} ${textSecondary} hover:border-[#00d4aa]/40 hover:text-[#00d4aa]`}
                      title="打开详细信息窗口（TET+MACD-V综合评估、卖出信号系统）"
                    >
                        详情 ▸
                    </button>
                    <button
                      onClick={() => removeHolding(h.ts_code)}
                      className="ml-1 text-xs px-2 py-1 rounded border border-[#ff4757]/30 text-[#ff4757]/80 hover:bg-[#ff4757]/10"
                      title="删除持仓"
                    >
                        ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
