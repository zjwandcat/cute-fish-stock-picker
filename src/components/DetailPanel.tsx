import { useEffect, useState } from 'react';
import { X, ArrowLeft, Calendar, FileText, TrendingUp, Users, AlertCircle, Activity, Scale } from 'lucide-react';
import { useStockStore } from '@/store/stockStore';
import { useUIStore } from '@/store/uiStore';
import KlineChart from './KlineChart';
import type { Meeting, MajorEvent, Dividend, Holder } from '@/types/stock';

/* ============ TET + MACD-V 综合评估信号数据 ============ */

interface SignalDataFE {
  ts_code: string;
  name: string;
  market: 'A' | 'HK';
  price: number;
  pct_chg: number;
  overall: { verdict: 'buy' | 'sell' | 'neutral'; text: string };
  tet: {
    trend_score: number;
    emotion_index: number;
    anchored_trend: number;
    timing: number;
    valid_votes: number;
    sell_signal: 'none' | 'weak' | 'strong';
    sell_reason: string;
    buy_signal: 'none' | 'watch' | 'good';
    buy_reason: string;
  };
  macdv: {
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
  };
  macdv_config: { strong: number; extreme: number };
  bars_count: number;
  bagholder: {
    available: boolean;
    signal_date: string | null;
    in_list: boolean;
    rank: number | null;
    score: number | null;
    percentile: number | null;
    factors: {
      price_chase_20: number;
      turn_spike: number;
      toplist_cnt_20: number;
      elg_net_20: number;
    } | null;
    raw: {
      rev_20: number | null;
      limit_touch_20: number | null;
      turn_spike: number | null;
      toplist_cnt_20: number | null;
      elg_net_20: number | null;
    } | null;
    signal: 'sell' | 'none';
    signal_text: string;
  } | null;
  ah_compare: {
    is_a_side: boolean;
    a_code: string;
    h_code: string;
    name: string;
    a_price: number;
    a_pct_chg: number;
    h_price: number;
    h_pct_chg: number;
    h_price_cny: number;
    fx_rate: number;
    fx_source: string;
    h_a_ratio: number;
    a_premium: number;
    dividend_yield: number;
    verdict: 'A' | 'H' | 'neutral';
    long_verdict: 'A' | 'H';
    advice: string;
    short_term_note: string;
    long_term_note: string;
    tax_notes: string[];
  } | null;
  holding: {
    buy_price: number;
    shares: number;
    buy_date: string;
    highest: number;
    sell: {
      signals: { name: string; triggered: boolean; weight: 1 | 2; detail: string }[];
      strong_count: number;
      weak_count: number;
      advice: 'strong_sell' | 'reduce' | 'hold' | 'add';
      advice_text: string;
    };
  } | null;
}

const OVERALL_STYLE: Record<SignalDataFE['overall']['verdict'], { color: string; text: string }> = {
  buy: { color: '#34C759', text: '买入' },
  sell: { color: '#FF3B30', text: '卖出' },
  neutral: { color: '#f0b90b', text: '不动' },
};

function formatMV(wanYuan: number): string {
  if (!wanYuan && wanYuan !== 0) return '--';
  if (wanYuan === 0) return '--';
  const yi = wanYuan / 10000;
  if (yi >= 10000) return (yi / 10000).toFixed(2) + '万亿';
  return yi.toFixed(2) + '亿';
}

function formatNum(val: number | undefined | null, decimals = 2): string {
  if (val === undefined || val === null) return '--';
  return val.toFixed(decimals);
}

export default function DetailPanel() {
  const { selectedStock, detailData, closeStock } = useStockStore();
  const { theme } = useUIStore();

  // TET + MACD-V 综合评估信号
  const [signalData, setSignalData] = useState<SignalDataFE | null>(null);
  const [signalError, setSignalError] = useState('');

  useEffect(() => {
    if (!selectedStock) return;
    let cancelled = false;
    setSignalData(null);
    setSignalError('');
    (async () => {
      try {
        const res = await fetch(`/api/stocks/${selectedStock}/signals`);
        const json = await res.json();
        if (cancelled) return;
        if (json.success) setSignalData(json.data);
        else setSignalError(json.message || '信号计算失败');
      } catch {
        if (!cancelled) setSignalError('信号加载失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedStock]);

  const isOpen = selectedStock !== null;
  const detail = detailData?.detail;
  const news = detailData?.news ?? [];
  const daily = detailData?.daily ?? [];
  const holders = detailData?.detail?.holders ?? [];

  const isLoading = isOpen && !detailData;
  const dark = theme === 'dark';

  return (
    <>
      {/* 遮罩层 - iOS 26 风格 */}
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-500 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          backgroundColor: dark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.2)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
        onClick={closeStock}
      />

      {/* 面板 - iOS 26 液态玻璃 */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-[480px] overflow-y-auto transition-transform duration-500 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{
          background: dark
            ? 'linear-gradient(135deg, rgba(28, 28, 30, 0.85) 0%, rgba(44, 44, 46, 0.75) 100%)'
            : 'linear-gradient(135deg, rgba(255, 255, 255, 0.85) 0%, rgba(245, 245, 247, 0.75) 100%)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          borderLeft: dark
            ? '0.5px solid rgba(255, 255, 255, 0.08)'
            : '0.5px solid rgba(255, 255, 255, 0.6)',
          boxShadow: dark
            ? '-20px 0 60px rgba(0, 0, 0, 0.5)'
            : '-20px 0 60px rgba(0, 0, 0, 0.1)',
        }}
      >
        {selectedStock && (
          <div className="p-6">
            {/* 返回按钮 */}
            <div className="mb-3">
              <button
                onClick={closeStock}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl transition-all duration-200 active:scale-95"
                style={{
                  background: dark
                    ? 'rgba(255, 255, 255, 0.08)'
                    : 'rgba(255, 255, 255, 0.6)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  border: dark
                    ? '0.5px solid rgba(255, 255, 255, 0.1)'
                    : '0.5px solid rgba(255, 255, 255, 0.8)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                }}
              >
                <ArrowLeft size={16} className="text-[#007AFF]" />
                <span className="text-sm font-medium text-[#007AFF]">返回</span>
              </button>
            </div>

            {/* 股票名称 + 关闭按钮 */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2
                  className="text-xl font-bold"
                  style={{ color: dark ? '#fff' : '#1c1c1e' }}
                >
                  {detail?.name || signalData?.name || ''}
                </h2>
                <span
                  className="text-sm font-mono"
                  style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}
                >
                  {selectedStock}
                </span>
              </div>
              <button
                onClick={closeStock}
                className="p-2.5 rounded-full transition-all duration-200 active:scale-90"
                style={{
                  background: dark
                    ? 'rgba(255, 255, 255, 0.08)'
                    : 'rgba(0, 0, 0, 0.04)',
                }}
              >
                <X
                  size={18}
                  style={{ color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(60,60,67,0.6)' }}
                />
              </button>
            </div>

            {/* 加载中 */}
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div
                    className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-transparent mb-3"
                    style={{
                      borderTopColor: '#007AFF',
                      borderRightColor: '#007AFF',
                    }}
                  />
                  <p
                    className="text-sm"
                    style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}
                  >
                    加载中...
                  </p>
                </div>
              </div>
            )}

            {!isLoading && (
              <>
                {/* K线图 */}
                {daily.length > 0 && (
                  <div className="mb-6 overflow-hidden rounded-3xl" style={{
                    background: dark
                      ? 'rgba(255, 255, 255, 0.04)'
                      : 'rgba(255, 255, 255, 0.6)',
                    border: dark
                      ? '0.5px solid rgba(255, 255, 255, 0.06)'
                      : '0.5px solid rgba(255, 255, 255, 0.8)',
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)',
                  }}>
                    <KlineChart />
                  </div>
                )}

                {/* TET + MACD-V 综合评估（是否值得买入/卖出/不建议操作） */}
                <SignalSection data={signalData} error={signalError} dark={dark} />

                {/* A+H 两地上市比价（仅 AH 股显示） */}
                {signalData?.ah_compare && (
                  <AHCompareSection data={signalData.ah_compare} dark={dark} />
                )}

                {/* 估值指标 */}
                <GlassSectionTitle title="估值指标" dark={dark} />
                <div className="grid grid-cols-3 gap-3 mb-6">
                  <GlassMetricCard label="PE(动态)" value={formatNum(detail?.pe_ttm)} dark={dark} />
                  <GlassMetricCard label="PE(静态)" value={formatNum(detail?.pe_static)} dark={dark} />
                  <GlassMetricCard label="PB" value={formatNum(detail?.pb)} dark={dark} />
                  <GlassMetricCard label="ROE" value={detail?.roe ? `${detail.roe.toFixed(2)}%` : '--'} dark={dark} />
                  <GlassMetricCard label="总市值" value={detail?.total_mv ? formatMV(detail.total_mv) : '--'} dark={dark} />
                  <GlassMetricCard label="流通市值" value={detail?.circ_mv ? formatMV(detail.circ_mv) : '--'} dark={dark} />
                </div>

                {/* 资金结构 */}
                <GlassSectionTitle title="资金结构" dark={dark} />
                <div
                  className="rounded-3xl p-5 mb-6 space-y-5"
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
                  {/* 机构占比 */}
                  <div>
                    <div className="flex justify-between text-xs mb-2">
                      <span style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}>
                        机构占比
                      </span>
                      <span className="font-mono font-semibold text-[#007AFF]">
                        {detail?.inst_ratio?.toFixed(2) ?? '--'}%
                      </span>
                    </div>
                    <div
                      className="h-2 rounded-full overflow-hidden"
                      style={{
                        background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                      }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: `${detail?.inst_ratio ?? 0}%`,
                          background: 'linear-gradient(90deg, #007AFF, #5AC8FA)',
                        }}
                      />
                    </div>
                  </div>

                  {/* 散户占比 */}
                  <div>
                    <div className="flex justify-between text-xs mb-2">
                      <span style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}>
                        散户占比
                      </span>
                      <span className="font-mono font-semibold text-[#FF9500]">
                        {detail?.retail_ratio?.toFixed(2) ?? '--'}%
                      </span>
                    </div>
                    <div
                      className="h-2 rounded-full overflow-hidden"
                      style={{
                        background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                      }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: `${detail?.retail_ratio ?? 0}%`,
                          background: 'linear-gradient(90deg, #FF9500, #FFCC00)',
                        }}
                      />
                    </div>
                  </div>

                  {/* 上一交易日资金流向 */}
                  <div
                    className="pt-4 space-y-3"
                    style={{
                      borderTop: dark
                        ? '0.5px solid rgba(255,255,255,0.08)'
                        : '0.5px solid rgba(0,0,0,0.06)',
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <span
                        className="text-xs font-medium"
                        style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}
                      >
                        上一交易日资金流向
                      </span>
                    </div>

                    {/* 机构流入/流出 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div
                        className="rounded-2xl p-3"
                        style={{
                          background: dark
                            ? 'rgba(0, 122, 255, 0.08)'
                            : 'rgba(0, 122, 255, 0.06)',
                          border: dark
                            ? '0.5px solid rgba(0, 122, 255, 0.15)'
                            : '0.5px solid rgba(0, 122, 255, 0.12)',
                        }}
                      >
                        <div
                          className="text-xs mb-1"
                          style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}
                        >
                          机构流入
                        </div>
                        <div className="font-mono text-sm font-bold text-[#34C759]">
                          {detail?.inst_inflow_ratio?.toFixed(2) ?? '0.00'}%
                        </div>
                      </div>
                      <div
                        className="rounded-2xl p-3"
                        style={{
                          background: dark
                            ? 'rgba(255, 59, 48, 0.08)'
                            : 'rgba(255, 59, 48, 0.06)',
                          border: dark
                            ? '0.5px solid rgba(255, 59, 48, 0.15)'
                            : '0.5px solid rgba(255, 59, 48, 0.12)',
                        }}
                      >
                        <div
                          className="text-xs mb-1"
                          style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}
                        >
                          机构流出
                        </div>
                        <div className="font-mono text-sm font-bold text-[#FF3B30]">
                          {detail?.inst_outflow_ratio?.toFixed(2) ?? '0.00'}%
                        </div>
                      </div>
                    </div>

                    {/* 散户流入/流出 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div
                        className="rounded-2xl p-3"
                        style={{
                          background: dark
                            ? 'rgba(52, 199, 89, 0.08)'
                            : 'rgba(52, 199, 89, 0.06)',
                          border: dark
                            ? '0.5px solid rgba(52, 199, 89, 0.15)'
                            : '0.5px solid rgba(52, 199, 89, 0.12)',
                        }}
                      >
                        <div
                          className="text-xs mb-1"
                          style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}
                        >
                          散户流入
                        </div>
                        <div className="font-mono text-sm font-bold text-[#34C759]">
                          {detail?.retail_inflow_ratio?.toFixed(2) ?? '0.00'}%
                        </div>
                      </div>
                      <div
                        className="rounded-2xl p-3"
                        style={{
                          background: dark
                            ? 'rgba(255, 149, 0, 0.08)'
                            : 'rgba(255, 149, 0, 0.06)',
                          border: dark
                            ? '0.5px solid rgba(255, 149, 0, 0.15)'
                            : '0.5px solid rgba(255, 149, 0, 0.12)',
                        }}
                      >
                        <div
                          className="text-xs mb-1"
                          style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}
                        >
                          散户流出
                        </div>
                        <div className="font-mono text-sm font-bold text-[#FF9500]">
                          {detail?.retail_outflow_ratio?.toFixed(2) ?? '0.00'}%
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 主力净流入 */}
                  <div
                    className="flex justify-between text-xs pt-3"
                    style={{
                      borderTop: dark
                        ? '0.5px solid rgba(255,255,255,0.08)'
                        : '0.5px solid rgba(0,0,0,0.06)',
                    }}
                  >
                    <span style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}>
                      主力净流入
                    </span>
                    <span
                      className={`font-mono font-semibold ${
                        (detail?.main_net_inflow ?? 0) >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'
                      }`}
                    >
                      {(detail?.main_net_inflow ?? 0) >= 0 ? '+' : ''}
                      {detail?.main_net_inflow
                        ? (detail.main_net_inflow / 10000).toFixed(2) + '亿'
                        : '--'}
                    </span>
                  </div>
                </div>

                {/* 量比数据 */}
                <GlassSectionTitle title="量比数据" dark={dark} />
                <div className="grid grid-cols-3 gap-3 mb-6">
                  <GlassMetricCard label="量比" value={formatNum(detail?.volume_ratio)} dark={dark} />
                  <GlassMetricCard
                    label="换手率"
                    value={detail?.turnover_rate ? `${detail.turnover_rate.toFixed(2)}%` : '--'}
                    dark={dark}
                  />
                  <GlassMetricCard
                    label="成交量"
                    value={detail?.volume ? (detail.volume / 10000).toFixed(2) + '万手' : '--'}
                    dark={dark}
                  />
                </div>

                {/* 十大流动股东 */}
                <GlassSectionTitle
                  title={`十大流动股东${
                    detail?.holder_count !== undefined ? `（共 ${detail.holder_count} 位）` : ''
                  }`}
                  icon={<Users size={14} />}
                  dark={dark}
                />
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
                  {/* 股东数量不足10个时的提示 */}
                  {detail?.holder_incomplete && detail?.holder_count !== undefined && (
                    <div
                      className="flex items-center gap-2 px-4 py-2.5 text-xs"
                      style={{
                        background: dark
                          ? 'rgba(255, 149, 0, 0.1)'
                          : 'rgba(255, 149, 0, 0.08)',
                        borderBottom: dark
                          ? '0.5px solid rgba(255, 255, 255, 0.06)'
                          : '0.5px solid rgba(0,0,0,0.04)',
                      }}
                    >
                      <AlertCircle size={14} className="text-[#FF9500]" />
                      <span className="text-[#FF9500]">
                        该股票流通股东不足 10 位，数据可能不完整
                      </span>
                    </div>
                  )}
                  {holders.length > 0 ? (
                    <table className="w-full text-xs">
                      <thead>
                        <tr
                          style={{
                            background: dark
                              ? 'rgba(255, 255, 255, 0.03)'
                              : 'rgba(0, 0, 0, 0.02)',
                          }}
                        >
                          <th
                            className="text-left py-3 px-4 font-medium"
                            style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}
                          >
                            股东名称
                          </th>
                          <th
                            className="text-right py-3 px-4 font-medium"
                            style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}
                          >
                            持股比例
                          </th>
                          <th
                            className="text-right py-3 px-4 font-medium"
                            style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}
                          >
                            持股数(万股)
                          </th>
                          <th
                            className="text-right py-3 px-4 font-medium"
                            style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}
                          >
                            变动
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {holders.map((h: Holder, i: number) => (
                          <tr
                            key={i}
                            style={{
                              borderTop: dark
                                ? '0.5px solid rgba(255, 255, 255, 0.04)'
                                : '0.5px solid rgba(0, 0, 0, 0.04)',
                            }}
                          >
                            <td
                              className="py-3 px-4 max-w-[160px] truncate"
                              style={{ color: dark ? '#fff' : '#1c1c1e' }}
                              title={h.holder_name}
                            >
                              {h.holder_name}
                            </td>
                            <td
                              className="py-3 px-4 text-right font-mono"
                              style={{ color: dark ? '#fff' : '#1c1c1e' }}
                            >
                              {h.hold_ratio ? h.hold_ratio.toFixed(2) + '%' : '--'}
                            </td>
                            <td
                              className="py-3 px-4 text-right font-mono"
                              style={{ color: dark ? '#fff' : '#1c1c1e' }}
                            >
                              {h.hold_amount ? (h.hold_amount / 10000).toFixed(2) : '--'}
                            </td>
                            <td
                              className={`py-3 px-4 text-right font-mono ${
                                h.hold_change > 0
                                  ? 'text-[#34C759]'
                                  : h.hold_change < 0
                                    ? 'text-[#FF3B30]'
                                    : ''
                              }`}
                              style={{
                                color:
                                  h.hold_change === 0
                                    ? dark
                                      ? 'rgba(255,255,255,0.4)'
                                      : 'rgba(60,60,67,0.4)'
                                    : undefined,
                              }}
                            >
                              {h.hold_change > 0 ? '+' : ''}
                              {h.hold_change || '--'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p
                      className="text-sm text-center py-6"
                      style={{ color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(60,60,67,0.4)' }}
                    >
                      暂无十大流动股东信息
                    </p>
                  )}
                </div>

                {/* 最近会议 */}
                <GlassSectionTitle title="最近会议" icon={<Calendar size={14} />} dark={dark} />
                <div className="space-y-3 mb-6">
                  {detail?.meetings && detail.meetings.length > 0 ? (
                    detail.meetings.map((meeting: Meeting, i: number) => (
                      <a
                        key={i}
                        href={meeting.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-4 rounded-2xl transition-all duration-200 active:scale-[0.98]"
                        style={{
                          background: dark
                            ? 'rgba(255, 255, 255, 0.04)'
                            : 'rgba(255, 255, 255, 0.6)',
                          backdropFilter: 'blur(20px)',
                          WebkitBackdropFilter: 'blur(20px)',
                          border: dark
                            ? '0.5px solid rgba(255, 255, 255, 0.06)'
                            : '0.5px solid rgba(255, 255, 255, 0.8)',
                          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
                        }}
                      >
                        <p
                          className="text-sm mb-1.5 line-clamp-1"
                          style={{ color: dark ? '#fff' : '#1c1c1e' }}
                        >
                          {meeting.title}
                        </p>
                        <div className="flex items-center gap-2 text-xs">
                          <span
                            style={{
                              color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(60,60,67,0.5)',
                            }}
                          >
                            {meeting.ann_date}
                          </span>
                          <span style={{ color: dark ? 'rgba(255,255,255,0.2)' : 'rgba(60,60,67,0.3)' }}>
                            ·
                          </span>
                          <span
                            style={{
                              color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(60,60,67,0.5)',
                            }}
                          >
                            {meeting.ann_type}
                          </span>
                        </div>
                      </a>
                    ))
                  ) : (
                    <p
                      className="text-sm text-center py-6"
                      style={{ color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(60,60,67,0.4)' }}
                    >
                      暂无会议信息
                    </p>
                  )}
                </div>

                {/* 大事件决策 */}
                <GlassSectionTitle title="大事件决策" icon={<FileText size={14} />} dark={dark} />
                <div className="space-y-3 mb-6">
                  {detail?.events && detail.events.length > 0 ? (
                    detail.events.map((event: MajorEvent, i: number) => (
                      <a
                        key={i}
                        href={event.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-4 rounded-2xl transition-all duration-200 active:scale-[0.98]"
                        style={{
                          background: dark
                            ? 'rgba(255, 255, 255, 0.04)'
                            : 'rgba(255, 255, 255, 0.6)',
                          backdropFilter: 'blur(20px)',
                          WebkitBackdropFilter: 'blur(20px)',
                          border: dark
                            ? '0.5px solid rgba(255, 255, 255, 0.06)'
                            : '0.5px solid rgba(255, 255, 255, 0.8)',
                          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
                        }}
                      >
                        <p
                          className="text-sm mb-1.5 line-clamp-1"
                          style={{ color: dark ? '#fff' : '#1c1c1e' }}
                        >
                          {event.title}
                        </p>
                        <div className="flex items-center gap-2 text-xs">
                          <span
                            style={{
                              color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(60,60,67,0.5)',
                            }}
                          >
                            {event.ann_date}
                          </span>
                          <span style={{ color: dark ? 'rgba(255,255,255,0.2)' : 'rgba(60,60,67,0.3)' }}>
                            ·
                          </span>
                          <span
                            style={{
                              color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(60,60,67,0.5)',
                            }}
                          >
                            {event.ann_type}
                          </span>
                        </div>
                      </a>
                    ))
                  ) : (
                    <p
                      className="text-sm text-center py-6"
                      style={{ color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(60,60,67,0.4)' }}
                    >
                      暂无大事件
                    </p>
                  )}
                </div>

                {/* 除权除息 */}
                <GlassSectionTitle title="除权除息" icon={<TrendingUp size={14} />} dark={dark} />
                <div className="space-y-3 mb-6">
                  {detail?.dividends && detail.dividends.length > 0 ? (
                    detail.dividends.map((dividend: Dividend, i: number) => (
                      <div
                        key={i}
                        className="p-4 rounded-2xl"
                        style={{
                          background: dark
                            ? 'rgba(255, 255, 255, 0.04)'
                            : 'rgba(255, 255, 255, 0.6)',
                          backdropFilter: 'blur(20px)',
                          WebkitBackdropFilter: 'blur(20px)',
                          border: dark
                            ? '0.5px solid rgba(255, 255, 255, 0.06)'
                            : '0.5px solid rgba(255, 255, 255, 0.8)',
                          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
                        }}
                      >
                        <div className="flex justify-between items-center mb-3">
                          <span
                            className="text-sm font-medium"
                            style={{ color: dark ? '#fff' : '#1c1c1e' }}
                          >
                            {dividend.end_date} 报告期
                          </span>
                          <span
                            className="text-xs px-2.5 py-1 rounded-full"
                            style={{
                              background: dark
                                ? 'rgba(255, 255, 255, 0.08)'
                                : 'rgba(0, 0, 0, 0.04)',
                              color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(60,60,67,0.6)',
                            }}
                          >
                            {dividend.div_proc}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <DividendRow
                            label="除权除息日"
                            value={dividend.ex_date}
                            dark={dark}
                          />
                          <DividendRow
                            label="股权登记日"
                            value={dividend.record_date}
                            dark={dark}
                          />
                          <DividendRow
                            label="每股送股"
                            value={dividend.stk_div > 0 ? String(dividend.stk_div) : '--'}
                            dark={dark}
                          />
                          <DividendRow
                            label="每股转增"
                            value={dividend.stk_bo_rate > 0 ? String(dividend.stk_bo_rate) : '--'}
                            dark={dark}
                          />
                          <DividendRow
                            label="每股派息(含税)"
                            value={dividend.cash_div > 0 ? String(dividend.cash_div) : '--'}
                            dark={dark}
                          />
                          <DividendRow
                            label="每股派息(税后)"
                            value={
                              dividend.cash_div_tax > 0 ? String(dividend.cash_div_tax) : '--'
                            }
                            dark={dark}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p
                      className="text-sm text-center py-6"
                      style={{ color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(60,60,67,0.4)' }}
                    >
                      暂无除权除息信息
                    </p>
                  )}
                </div>

                {/* 公司新闻 */}
                <GlassSectionTitle title="公司新闻" dark={dark} />
                <div className="space-y-3">
                  {news.slice(0, 5).map((item, i) => (
                    <a
                      key={i}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-4 rounded-2xl transition-all duration-200 active:scale-[0.98]"
                      style={{
                        background: dark
                          ? 'rgba(255, 255, 255, 0.04)'
                          : 'rgba(255, 255, 255, 0.6)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        border: dark
                          ? '0.5px solid rgba(255, 255, 255, 0.06)'
                          : '0.5px solid rgba(255, 255, 255, 0.8)',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
                      }}
                    >
                      <p
                        className="text-sm mb-1.5 line-clamp-1"
                        style={{ color: dark ? '#fff' : '#1c1c1e' }}
                      >
                        {item.title}
                      </p>
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          style={{
                            color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(60,60,67,0.5)',
                          }}
                        >
                          {item.src}
                        </span>
                        <span style={{ color: dark ? 'rgba(255,255,255,0.2)' : 'rgba(60,60,67,0.3)' }}>
                          ·
                        </span>
                        <span
                          style={{
                            color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(60,60,67,0.5)',
                          }}
                        >
                          {item.time}
                        </span>
                      </div>
                    </a>
                  ))}
                  {news.length === 0 && (
                    <p
                      className="text-sm text-center py-6"
                      style={{ color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(60,60,67,0.4)' }}
                    >
                      暂无新闻
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function DividendRow({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)' }}>
        {label}
      </span>
      <span
        className="font-mono"
        style={{ color: dark ? '#fff' : '#1c1c1e' }}
      >
        {value}
      </span>
    </div>
  );
}

function GlassSectionTitle({
  title,
  icon,
  dark,
}: {
  title: string;
  icon?: React.ReactNode;
  dark: boolean;
}) {
  return (
    <h3
      className="text-xs font-semibold mb-3 uppercase tracking-wider flex items-center gap-1.5"
      style={{ color: dark ? 'rgba(255,255,255,0.45)' : 'rgba(60,60,67,0.5)' }}
    >
      {icon}
      {title}
    </h3>
  );
}

/* ============ TET + MACD-V 综合评估区块 ============ */

function SignalSection({
  data,
  error,
  dark,
}: {
  data: SignalDataFE | null;
  error: string;
  dark: boolean;
}) {
  const panelBg = dark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.6)';
  const border = dark ? '0.5px solid rgba(255, 255, 255, 0.06)' : '0.5px solid rgba(255, 255, 255, 0.8)';
  const textPrimary = dark ? '#fff' : '#1c1c1e';
  const textSecondary = dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)';

  return (
    <div className="mb-6">
      <GlassSectionTitle title="综合评估 · TET × MACD-V" icon={<Activity size={14} />} dark={dark} />

      {error && (
        <div className="rounded-3xl p-4 text-sm" style={{ background: panelBg, border, color: '#FF3B30' }}>
          {error}
        </div>
      )}
      {!error && !data && (
        <div className="rounded-3xl p-4 text-sm text-center" style={{ background: panelBg, border, color: textSecondary }}>
          TET 与 MACD-V 信号计算中（约需数秒）...
        </div>
      )}

      {data && (
        <div className="space-y-3">
          {/* 综合结论 */}
          <div
            className="rounded-3xl p-4"
            style={{
              background: `${OVERALL_STYLE[data.overall.verdict].color}12`,
              border: `0.5px solid ${OVERALL_STYLE[data.overall.verdict].color}55`,
            }}
          >
            <div className="flex items-center gap-3">
              <span
                className="text-base font-bold px-3 py-1 rounded-full"
                style={{
                  color: OVERALL_STYLE[data.overall.verdict].color,
                  background: `${OVERALL_STYLE[data.overall.verdict].color}18`,
                  border: `0.5px solid ${OVERALL_STYLE[data.overall.verdict].color}45`,
                }}
              >
                {OVERALL_STYLE[data.overall.verdict].text}
              </span>
              <span className="text-xs font-mono" style={{ color: textSecondary }}>
                {data.market === 'HK' ? 'HK$' : '¥'}{data.price.toFixed(2)}（{data.pct_chg >= 0 ? '+' : ''}{data.pct_chg.toFixed(2)}%）
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: textPrimary }}>
              {data.overall.text}
            </p>
          </div>

          {/* TET + MACD-V 指标 */}
          <div className="grid grid-cols-1 gap-3">
            <div className="rounded-3xl p-4" style={{ background: panelBg, border }}>
              <div className="text-xs font-bold mb-2" style={{ color: textSecondary }}>
                TET 趋势·情绪·时机（NAAIM 2025, Dr. Oliver Reiss）
              </div>
              <div className="space-y-1.5 text-xs">
                <SignalMetric label="趋势分" value={data.tet.trend_score.toFixed(3)} hint="[-1,1] 40个趋势指标投票均值，>0 上升趋势" color={data.tet.trend_score > 0.2 ? '#FF3B30' : data.tet.trend_score < -0.2 ? '#34C759' : undefined} secondary={textSecondary} primary={textPrimary} />
                <SignalMetric label="情绪指数" value={data.tet.emotion_index.toFixed(3)} hint=">0.5 超买(均值回归风险)，<−0.2 超卖(论文最佳买点)" color={data.tet.emotion_index < -0.2 ? '#34C759' : data.tet.emotion_index > 0.5 ? '#f0b90b' : undefined} secondary={textSecondary} primary={textPrimary} />
                <SignalMetric label="锚定趋势" value={data.tet.anchored_trend.toFixed(3)} hint="情绪最平静时刻的趋势分（去情绪干扰）" color={data.tet.anchored_trend > 0.2 ? '#FF3B30' : data.tet.anchored_trend < -0.2 ? '#34C759' : undefined} secondary={textSecondary} primary={textPrimary} />
                <SignalMetric label="时机指标" value={data.tet.timing.toFixed(3)} hint="= 锚定趋势 − 情绪，|值|≥1.0 为显著时机" color={Math.abs(data.tet.timing) >= 1 ? '#f0b90b' : undefined} secondary={textSecondary} primary={textPrimary} />
                <div className="pt-2 border-t text-xs" style={{ borderColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: textSecondary }}>
                  TET 判断：{data.tet.buy_reason}（有效票 {data.tet.valid_votes}/40）
                </div>
              </div>
            </div>

            <div className="rounded-3xl p-4" style={{ background: panelBg, border }}>
              <div className="text-xs font-bold mb-2" style={{ color: textSecondary }}>
                MACD-V 波动率归一化动量（SSRN #4099617, NAAIM 2022）
              </div>
              <div className="space-y-1.5 text-xs">
                <SignalMetric label="MACD-V" value={String(data.macdv.macdv)} hint={`=(EMA12−EMA26)/ATR×100，阈值 ±${data.macdv_config.strong}/±${data.macdv_config.extreme}`} color={data.macdv.macdv > data.macdv_config.extreme ? '#FF3B30' : data.macdv.macdv > 0 ? '#34C759' : '#f0b90b'} secondary={textSecondary} primary={textPrimary} />
                <SignalMetric label="信号线 / 柱" value={`${data.macdv.signal} / ${data.macdv.histogram}`} hint={`前日柱 ${data.macdv.prev_histogram}，柱转负=死叉`} color={data.macdv.histogram > 0 ? '#FF3B30' : '#34C759'} secondary={textSecondary} primary={textPrimary} />
                <div className="pt-1">
                  <span className="px-2 py-1 rounded text-xs font-medium" style={{ background: panelBg, border, color: textPrimary }}>
                    {data.macdv.stage_text}
                  </span>
                  <div className="mt-1" style={{ color: textSecondary }}>{data.macdv.stage_action}</div>
                </div>
                <div className="pt-2 border-t text-xs" style={{ borderColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: textSecondary }}>
                  MACD-V 判断：{data.macdv.buy_reason}
                </div>
              </div>
            </div>
          </div>

          {/* 韭菜50第三信号卡片（A股市值前1000池内股票；两态：卖出避雷 / 无信号） */}
          {data.bagholder && data.bagholder.available && (
            <BagholderSection data={data.bagholder} dark={dark} />
          )}

          {/* 持仓卖出信号明细（仅持仓股显示，主结论见上方综合评估） */}
          {data.holding && data.holding.sell && (
            <div className="rounded-3xl p-4" style={{ background: panelBg, border }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold" style={{ color: textSecondary }}>
                  持仓卖出信号明细（11项机制）
                </span>
                <span className="text-xs font-mono" style={{ color: textSecondary }}>
                  {data.holding.sell.strong_count}强/{data.holding.sell.weak_count}弱
                </span>
              </div>
              <p className="text-xs mb-2" style={{ color: textPrimary }}>{data.holding.sell.advice_text}</p>
              {data.holding.highest > 0 && (
                <p className="text-xs mb-2" style={{ color: textSecondary }}>
                  持仓期最高 {data.holding.highest.toFixed(2)}（移动止盈基准）
                </p>
              )}
              <div className="space-y-1.5">
                {data.holding.sell.signals.map((s) => (
                  <div key={s.name} className="flex items-start gap-2">
                    <span
                      className="text-xs mt-0.5 w-11 shrink-0 text-center rounded px-1 py-0.5 border font-medium"
                      style={
                        s.triggered
                          ? { color: s.weight === 2 ? '#FF3B30' : '#f0b90b', borderColor: s.weight === 2 ? 'rgba(255,59,48,0.4)' : 'rgba(240,185,11,0.4)', background: s.weight === 2 ? 'rgba(255,59,48,0.1)' : 'rgba(240,185,11,0.1)' }
                          : { color: textSecondary, borderColor: 'transparent' }
                      }
                    >
                      {s.triggered ? (s.weight === 2 ? '强✓' : '弱✓') : '—'}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-medium" style={{ color: s.triggered ? textPrimary : textSecondary }}>{s.name}</div>
                      <div className="text-xs break-words" style={{ color: textSecondary }}>{s.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-xs text-center" style={{ color: textSecondary }}>
            算法来源：TET 论文（NAAIM Founders Award 2025）· MACD-V 论文（SSRN #4099617）· K线 {data.bars_count} 根
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ A+H 两地上市比价区块 ============ */

function AHCompareSection({
  data,
  dark,
}: {
  data: NonNullable<SignalDataFE['ah_compare']>;
  dark: boolean;
}) {
  const [showAnalysis, setShowAnalysis] = useState(false);

  const panelBg = dark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.6)';
  const border = dark ? '0.5px solid rgba(255, 255, 255, 0.06)' : '0.5px solid rgba(255, 255, 255, 0.8)';
  const textPrimary = dark ? '#fff' : '#1c1c1e';
  const textSecondary = dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,60,67,0.6)';

  const verdictStyle =
    data.verdict === 'H'
      ? { color: '#34C759', label: '优先买 H 股' }
      : { color: '#007AFF', label: '优先买 A 股' };
  const marketColor = (m: 'A' | 'H') => (m === 'H' ? '#34C759' : '#007AFF');
  const shortMarket: 'A' | 'H' = data.verdict === 'H' ? 'H' : 'A';

  const absPremium = Math.abs(data.a_premium).toFixed(1);
  // 折溢价标签：a_premium>0 表示 A 股贵、H 股便宜
  const aTag =
    data.a_premium >= 0
      ? { text: `溢价 +${absPremium}%`, color: '#FF9F0A' }
      : { text: `折价 ${absPremium}%`, color: '#34C759' };
  const hTag =
    data.a_premium >= 0
      ? { text: `折价 ${absPremium}%`, color: '#34C759' }
      : { text: `溢价 +${absPremium}%`, color: '#FF9F0A' };

  return (
    <div className="mb-6">
      <GlassSectionTitle title="AH 股比价" icon={<Scale size={14} />} dark={dark} />

      <div className="space-y-3">
        {/* 主结论 */}
        <div
          className="rounded-3xl p-4"
          style={{
            background: `${verdictStyle.color}12`,
            border: `0.5px solid ${verdictStyle.color}55`,
          }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="text-sm font-bold px-3 py-1 rounded-full"
              style={{
                color: verdictStyle.color,
                background: `${verdictStyle.color}18`,
                border: `0.5px solid ${verdictStyle.color}45`,
              }}
            >
              {verdictStyle.label}
            </span>
            <span className="text-xs font-mono" style={{ color: textSecondary }}>
              {data.name}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: textPrimary }}>
            {data.advice}
          </p>
        </div>

        {/* 两地价格与折价 */}
        <div className="grid grid-cols-2 gap-3">
          <div
            className="rounded-3xl p-4"
            style={{
              background: panelBg,
              border,
              outline: data.verdict === 'A' ? `1px solid ${verdictStyle.color}60` : 'none',
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold" style={{ color: textSecondary }}>
                A 股{data.is_a_side ? '（当前）' : ''}
              </span>
              <span className="text-xs font-mono" style={{ color: textSecondary }}>
                {data.a_code}
              </span>
            </div>
            <div className="font-mono text-base font-bold" style={{ color: textPrimary }}>
              ¥{data.a_price.toFixed(2)}
            </div>
            <div className="text-xs font-mono mt-0.5" style={{ color: aTag.color }}>
              较 H 股{aTag.text}
            </div>
          </div>

          <div
            className="rounded-3xl p-4"
            style={{
              background: panelBg,
              border,
              outline: data.verdict === 'H' ? `1px solid ${verdictStyle.color}60` : 'none',
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold" style={{ color: textSecondary }}>
                H 股{!data.is_a_side ? '（当前）' : ''}
              </span>
              <span className="text-xs font-mono" style={{ color: textSecondary }}>
                {data.h_code}
              </span>
            </div>
            <div className="font-mono text-base font-bold" style={{ color: textPrimary }}>
              HK${data.h_price.toFixed(2)}
            </div>
            <div className="text-xs font-mono mt-0.5" style={{ color: textSecondary }}>
              ≈¥{data.h_price_cny.toFixed(2)}
              <span className="ml-1.5" style={{ color: hTag.color }}>
                较 A 股{hTag.text}
              </span>
            </div>
          </div>
        </div>

        {/* 分析按钮：展开计算过程 */}
        <button
          onClick={() => setShowAnalysis((v) => !v)}
          className="w-full rounded-2xl py-2 text-xs font-medium transition-colors"
          style={{
            background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            border,
            color: textPrimary,
          }}
        >
          {showAnalysis ? '收起分析 ▴' : '分析：如何得出结论 ▾'}
        </button>

        {/* 计算过程（算法已计入红利税/印花税/汇兑成本，作为因子参与计算） */}
        {showAnalysis && (
          <div className="rounded-3xl p-4 space-y-3" style={{ background: panelBg, border }}>
            <div>
              <div className="text-xs font-bold mb-1.5" style={{ color: textSecondary }}>
                比价计算
              </div>
              <div className="text-xs font-mono leading-relaxed" style={{ color: textPrimary }}>
                A股溢价率 = A股价 ÷（H股价 × 汇率）− 1
                <br />= ¥{data.a_price.toFixed(2)} ÷（HK${data.h_price.toFixed(2)} × {data.fx_rate.toFixed(4)}）− 1
                <br />= <span style={{ color: data.a_premium >= 0 ? '#FF9F0A' : '#34C759' }}>
                  {data.a_premium >= 0 ? '+' : ''}
                  {data.a_premium.toFixed(2)}%
                </span>
                ，即{data.a_premium >= 0 ? `H 股折价 ${absPremium}%` : `A 股折价 ${absPremium}%`}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold" style={{ color: textSecondary }}>
                  短线视角
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ color: marketColor(shortMarket), background: `${marketColor(shortMarket)}18` }}
                >
                  {shortMarket === 'H' ? 'H 股' : 'A 股'}
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: textPrimary }}>
                {data.short_term_note}
              </p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold" style={{ color: textSecondary }}>
                  长期持有视角
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{
                    color: marketColor(data.long_verdict),
                    background: `${marketColor(data.long_verdict)}18`,
                  }}
                >
                  {data.long_verdict === 'H' ? 'H 股' : 'A 股'}
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: textPrimary }}>
                {data.long_term_note}
              </p>
            </div>

            <div>
              <div className="text-xs font-bold mb-1" style={{ color: textSecondary }}>
                计算参数
              </div>
              <div className="text-xs font-mono" style={{ color: textPrimary }}>
                比价 H/A {data.h_a_ratio.toFixed(2)}% ｜ 汇率 {data.fx_rate.toFixed(4)}
                ｜ 股息率 {data.dividend_yield > 0 ? `${data.dividend_yield.toFixed(2)}%` : '--'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SignalMetric({
  label,
  value,
  hint,
  color,
  secondary,
  primary,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
  secondary: string;
  primary: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 flex-wrap">
      <span style={{ color: secondary }}>{label}</span>
      <span className="font-mono font-bold" style={color ? { color } : { color: primary }}>{value}</span>
      {hint && <span className="basis-full" style={{ color: secondary }}>{hint}</span>}
    </div>
  );
}

function GlassMetricCard({
  label,
  value,
  dark,
}: {
  label: string;
  value: string;
  dark: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-3"
      style={{
        background: dark
          ? 'rgba(255, 255, 255, 0.04)'
          : 'rgba(255, 255, 255, 0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: dark
          ? '0.5px solid rgba(255, 255, 255, 0.06)'
          : '0.5px solid rgba(255, 255, 255, 0.8)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
      }}
    >
      <div
        className="text-xs mb-1"
        style={{ color: dark ? 'rgba(255,255,255,0.45)' : 'rgba(60,60,67,0.5)' }}
      >
        {label}
      </div>
      <div
        className="text-sm font-mono font-semibold"
        style={{ color: dark ? '#fff' : '#1c1c1e' }}
      >
        {value}
      </div>
    </div>
  );
}
