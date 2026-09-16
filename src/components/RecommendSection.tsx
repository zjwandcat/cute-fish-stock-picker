import { useEffect, useRef, useState } from 'react';
import { useStockStore, type RecommendationMode } from '@/store/stockStore';
import { useUIStore } from '@/store/uiStore';
import type { MonthlyReport, Recommendation } from '@/types/stock';
import ModeButton, { ALGO_TIPS } from './ModeButton';
import { CircleAlert, FileChartColumn, RefreshCw, X } from 'lucide-react';

/** 今日推荐的四种排序模式（资金面=当前综合评分方案） */
const REC_MODES: { key: RecommendationMode; label: string; tip: string }[] = [
  { key: 'capital', label: '资金面', tip: ALGO_TIPS.capital },
  { key: 'tet', label: 'TET', tip: ALGO_TIPS.tet },
  { key: 'macdv', label: 'MACD-V', tip: ALGO_TIPS.macdv },
  { key: 'double', label: '双共振', tip: ALGO_TIPS.double },
];

const scoreColor = (score: number) => {
  if (score >= 80) return '#00d4aa';
  if (score >= 60) return '#f0b90b';
  return '#ff4757';
};

const reasonColorMap: Record<string, string> = {
  '放量上涨': 'bg-[#00d4aa]/15 text-[#00d4aa] border-[#00d4aa]/30',
  '突破均线': 'bg-[#f0b90b]/15 text-[#f0b90b] border-[#f0b90b]/30',
  '资金流入': 'bg-[#3b82f6]/15 text-[#3b82f6] border-[#3b82f6]/30',
  '低估': 'bg-[#8b5cf6]/15 text-[#8b5cf6] border-[#8b5cf6]/30',
  'MACD金叉': 'bg-[#ec4899]/15 text-[#ec4899] border-[#ec4899]/30',
  'RSI超卖': 'bg-[#f97316]/15 text-[#f97316] border-[#f97316]/30',
};

const getReasonClass = (reason: string, dark: boolean) => {
  return reasonColorMap[reason] ?? (dark
    ? 'bg-[#30363d]/50 text-[#8b949e] border-[#30363d]'
    : 'bg-[#e5e7eb]/50 text-[#6b7280] border-[#e5e7eb]');
};

export default function RecommendSection() {
  const [reportOpen, setReportOpen] = useState(false);
  const [focusedStock, setFocusedStock] = useState<Recommendation | null>(null);
  const recommendations = useStockStore((s) => s.recommendations) ?? [];
  const monthlyRecommendations = useStockStore((s) => s.monthlyRecommendations) ?? [];
  const monthlyReport = useStockStore((s) => s.monthlyReport);
  const monthlyLoading = useStockStore((s) => s.monthlyLoading);
  const recommendationView = useStockStore((s) => s.recommendationView);
  const setRecommendationView = useStockStore((s) => s.setRecommendationView);
  const selectStock = useStockStore((s) => s.selectStock);
  const recommendationMode = useStockStore((s) => s.recommendationMode);
  const setRecommendationMode = useStockStore((s) => s.setRecommendationMode);
  const { theme } = useUIStore();
  const dark = theme === 'dark';

  const cardBg = dark ? 'bg-[#161b22]' : 'bg-white';
  const border = dark ? 'border-[#30363d]' : 'border-[#e5e7eb]';
  const textPrimary = dark ? 'text-white' : 'text-[#1f2937]';
  const textSecondary = dark ? 'text-[#8b949e]' : 'text-[#6b7280]';

  // 双共振模式可能筛出 0 只：显示空态提示而不是隐藏整个区域（否则无法切回其他模式）
  const displayed = recommendationView === 'monthly' ? monthlyRecommendations : recommendations;
  const isEmpty = displayed.length === 0;
  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <section className="mb-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[#f0b90b] text-lg">★</span>
        <h2 className={`text-base font-bold ${textPrimary}`} style={{ fontFamily: '"Noto Sans SC", sans-serif' }}>
          {recommendationView === 'monthly' ? '本月推荐' : '今日推荐买入'}
        </h2>
        {recommendationView === 'monthly' && (
          <button
            type="button"
            aria-label="查看本月报告"
            title="查看本月报告"
            onClick={() => setReportOpen(true)}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border ${border} ${textSecondary} hover:text-[#f0b90b] hover:border-[#f0b90b]/50`}
          >
            <CircleAlert size={15} strokeWidth={1.8} />
          </button>
        )}
        <span className={`text-xs ${textSecondary} ml-2`}>{recommendationView === 'monthly' ? `${monthlyReport?.recommendation_month ?? '待计算'} 持仓` : today}</span>
        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          {recommendationView === 'daily' && REC_MODES.map((m) => (
            <ModeButton
              key={m.key}
              label={m.label}
              tip={m.tip}
              active={recommendationMode === m.key}
              onClick={() => setRecommendationMode(m.key)}
            />
          ))}
          <button
            type="button"
            onClick={() => setRecommendationView(recommendationView === 'daily' ? 'monthly' : 'daily')}
            className="rounded px-3 py-1.5 text-xs border border-[#f0b90b]/50 text-[#f0b90b]"
          >
            {recommendationView === 'daily' ? '本月推荐' : '今日推荐买入'}
          </button>
        </div>
      </div>
      {recommendationView === 'monthly' && monthlyReport?.status !== 'ready' && monthlyReport?.message && (
        <p role="status" className="mb-3 border-l-2 border-amber-500 pl-3 text-sm text-amber-600 dark:text-amber-400">{monthlyReport.message}</p>
      )}
      {recommendationView === 'monthly' && (
        <div className="mb-3 flex justify-end">
          <button type="button" aria-label="刷新月度数据" title="刷新月度数据" disabled={monthlyLoading}
            onClick={() => useStockStore.getState().fetchMonthlyRecommendations()}
            className={`p-2 ${textSecondary} disabled:opacity-40`}><RefreshCw size={16} className={monthlyLoading ? 'animate-spin' : ''} /></button>
        </div>
      )}
      <div className={recommendationView === 'monthly' ? 'grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-5' : 'flex gap-4 overflow-x-auto pb-3 scrollbar-thin'}>
        {monthlyLoading && recommendationView === 'monthly' && (
          <div className={`col-span-full w-full p-6 rounded-lg ${cardBg} border ${border} text-center text-sm ${textSecondary}`}>
            正在运行 M0 → M1 → M2 → M3 → M4 月度计算…
          </div>
        )}
        {isEmpty && !monthlyLoading && (
          <div className={`col-span-full w-full p-6 rounded-lg ${cardBg} border ${border} text-center text-sm ${textSecondary}`}>
            {recommendationView === 'monthly' ? '当前没有可用的真实月度算法结果，请查看本月报告中的数据状态。' : '当前股池中没有 TET 与 MACD-V 同时发出买入信号的股票，可切换其他模式查看'}
          </div>
        )}
        {displayed.map((rec) => recommendationView === 'monthly' ? (
          <div key={rec.ts_code} className={`min-w-0 border-b py-4 ${border}`}>
            <div className="flex items-start justify-between gap-2">
              <button type="button" onDoubleClick={() => selectStock(rec.ts_code)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectStock(rec.ts_code); } }}
                className="min-w-0 text-left" title="股票详情">
                <span className={`block break-words text-sm font-semibold ${textPrimary}`}>{rec.name}</span>
                <span className={`mt-1 block font-mono text-xs ${textSecondary}`}>{rec.ts_code}</span>
              </button>
              <span className={`shrink-0 font-mono text-lg ${rec.tier === 'High' ? 'text-emerald-500' : 'text-amber-500'}`}>{((rec.adjusted_weight ?? rec.weight ?? 0) * 100).toFixed(0)}%</span>
            </div>
            <p className={`mt-3 text-xs leading-5 ${textSecondary}`}>{rec.summary ?? rec.attribution}</p>
            <div className={`mt-2 flex items-center justify-between text-xs ${textSecondary}`}>
              <span>{rec.tier === 'High' ? '高比例组' : '低比例组'} · {rec.m3_action === 'HOLD' ? '持有' : '风控减仓'}</span>
              <button type="button" title={`${rec.name}专业归因`} aria-label={`${rec.name}专业归因`}
                onClick={() => { setFocusedStock(rec); setReportOpen(true); }}
                onDoubleClick={() => { setFocusedStock(rec); setReportOpen(true); }}
                className="p-2 hover:text-emerald-500"><FileChartColumn size={16} /></button>
            </div>
          </div>
        ) : (
          <div
            key={rec.ts_code}
            onClick={() => selectStock(rec.ts_code)}
            onDoubleClick={() => selectStock(rec.ts_code)}
            className={`flex-shrink-0 w-64 p-4 rounded-xl ${cardBg} border ${border} cursor-pointer transition-all duration-200 hover:border-[#f0b90b]/40 hover:shadow-[0_0_16px_rgba(240,185,11,0.1)]`}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className={`${textPrimary} font-bold text-sm`}>{rec.name}</span>
                <span className={`${textSecondary} text-xs ml-2 font-mono`}>{rec.ts_code}</span>
              </div>
              <div className="flex flex-col items-end">
                <span
                  className="text-2xl font-bold font-mono"
                  style={{ color: scoreColor(rec.score) }}
                >
                  {rec.score}
                </span>
                {recommendationMode !== 'capital' && (
                  <span className={`text-xs ${textSecondary}`}>
                    {recommendationMode === 'tet' ? 'TET买入分' : recommendationMode === 'macdv' ? 'MACD-V买入分' : '资金面分'}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              {rec.next_day_adjust !== undefined && rec.next_day_adjust !== 0 && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded border font-mono ${
                    rec.next_day_adjust > 0
                      ? 'bg-[#00d4aa]/15 text-[#00d4aa] border-[#00d4aa]/30'
                      : 'bg-[#ff4757]/15 text-[#ff4757] border-[#ff4757]/30'
                  }`}
                >
                  T+1 {rec.next_day_adjust > 0 ? '+' : ''}{rec.next_day_adjust}
                </span>
              )}
              {rec.risk_level && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded border ${
                    rec.risk_level === 'low'
                      ? 'bg-[#00d4aa]/10 text-[#00d4aa] border-[#00d4aa]/20'
                      : rec.risk_level === 'medium'
                        ? 'bg-[#f0b90b]/10 text-[#f0b90b] border-[#f0b90b]/20'
                        : 'bg-[#ff4757]/10 text-[#ff4757] border-[#ff4757]/20'
                  }`}
                >
                  {rec.risk_level === 'low' ? '低风险' : rec.risk_level === 'medium' ? '中风险' : '高风险'}
                </span>
              )}
            </div>

            {(
              <div className="space-y-2 mb-3">
                <ScoreBar label="技术面" score={rec.tech_score} />
                <ScoreBar label="基本面" score={rec.fund_score} />
                <ScoreBar label="资金面" score={rec.capital_score} />
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {rec.reasons.map((reason, i) => (
                <span
                  key={i}
                  className={`text-xs px-2 py-0.5 rounded-full border ${getReasonClass(reason, dark)}`}
                >
                  {reason}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {reportOpen && (
        <MonthlyReportModal report={monthlyReport} focusedStock={focusedStock} dark={dark} onClose={() => { setReportOpen(false); setFocusedStock(null); }} />
      )}
    </section>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const { theme } = useUIStore();
  const dark = theme === 'dark';
  const color = scoreColor(score);
  const labelColor = dark ? 'text-[#8b949e]' : 'text-[#6b7280]';
  const barBg = dark ? 'bg-[#30363d]' : 'bg-[#e5e7eb]';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`${labelColor} shrink-0 whitespace-nowrap`}>{label}</span>
      <div className={`flex-1 h-1.5 rounded-full ${barBg} overflow-hidden`}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-mono w-6 text-right" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

function MonthlyReportModal({
  report,
  focusedStock,
  dark,
  onClose,
}: {
  report: MonthlyReport | null;
  focusedStock: Recommendation | null;
  dark: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button, summary, [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [onClose]);
  const panel = dark ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-[#e5e7eb]';
  const primary = dark ? 'text-white' : 'text-[#1f2937]';
  const secondary = dark ? 'text-[#8b949e]' : 'text-[#6b7280]';
  const rows = [...(report?.high ?? []), ...(report?.low ?? [])];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-label="本月报告"
        className={`max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-lg border p-5 shadow-2xl ${panel}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className={`text-lg font-bold ${primary}`}>{focusedStock ? `${focusedStock.name} · 专业归因` : '本月报告'}</h3>
            <p className={`mt-1 text-xs ${secondary}`}>机械归因摘要，不使用 LLM</p>
          </div>
          <button type="button" title="关闭" aria-label="关闭" onClick={onClose} className={secondary}>
            <X size={18} />
          </button>
        </div>

        {!report ? (
          <p className={`mt-6 text-sm ${secondary}`}>月度计算尚未完成。</p>
        ) : (
          <>
            {focusedStock && <StockAttribution rec={focusedStock} secondary={secondary} />}
            <div className={`mt-5 grid grid-cols-2 gap-3 text-xs ${secondary} sm:grid-cols-4`}>
              <ReportMetric label="模型" value={report.model} />
              <ReportMetric label="中性化" value={report.scheme} />
              <ReportMetric label="数据截至" value={report.data_as_of ?? '—'} />
              <ReportMetric label="预测月份" value={report.recommendation_month ?? '—'} />
            </div>
            <details className="mt-5 border-b pb-4">
              <summary className={`cursor-pointer text-sm ${primary}`}>算法与运行明细</summary>
              <h4 className={`text-sm font-semibold ${primary}`}>算法配置</h4>
              <div className={`mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4 ${secondary}`}>
                <ReportMetric label="Trial" value={`#${String(report.config.trial ?? '—')}`} />
                <ReportMetric label="训练窗口" value={`${String(report.config.train_months ?? '—')} 个月`} />
                <ReportMetric label="验证窗口" value={`${String(report.config.validation_months ?? '—')} 个月`} />
                <ReportMetric label="保留因子" value={String(report.config.selected_factors ?? '—')} />
                <ReportMetric label="LightGBM 树数" value={String(report.config.lgbm_estimators ?? '—')} />
                <ReportMetric label="XGBoost 树数" value={String(report.config.xgb_estimators ?? '—')} />
                <ReportMetric label="模型深度" value={`${String(report.config.lgbm_depth ?? '—')} / ${String(report.config.xgb_depth ?? '—')}`} />
                <ReportMetric label="LightGBM 权重" value={formatConfigNumber(report.config.lgbm_weight)} />
                <ReportMetric label="XGBoost 权重" value={formatConfigNumber(report.config.xgb_weight)} />
                <ReportMetric label="最小 IC" value={formatConfigNumber(report.config.min_ic_abs)} />
                <ReportMetric label="最大相关性" value={formatConfigNumber(report.config.max_corr)} />
                <ReportMetric label="执行设备" value={`LGBM ${report.config.lgbm_device ?? '—'} / XGB ${report.config.xgb_device ?? '—'}`} />
                <ReportMetric label="计算耗时" value={`${report.timings?.total ?? '—'} 秒${report.cache_hit ? '（复用结果）' : ''}`} />
                <ReportMetric label="验证 IC" value={formatConfigNumber(report.config.val_ic)} />
                <ReportMetric label="筛选后股票池" value={String(report.config.pool_after ?? '—')} />
              </div>
              <p className={`mt-3 text-xs leading-5 ${secondary}`}>
                执行链路：{report.pipeline.length > 0 ? report.pipeline.join(' → ') : '暂无'}。股票池使用 M0 stock_filter.py，结果按 M2 评分分为高比例组与低比例组。
              </p>
              <p className={`mt-3 break-words text-xs leading-5 ${secondary}`}>{String(report.config.attribution_method ?? '')}。{String(report.config.m3_mode ?? '')}。归因解释模型评分，不代表未来收益。</p>
              <p className={`mt-2 break-all text-xs ${secondary}`}>计算标识：{report.fingerprint?.slice(0, 16) ?? '—'} · {report.generated_at ?? ''}</p>
            </details>
            {report.status !== 'ready' && (
              <div className="mt-4 rounded-lg border border-[#f0b90b]/40 bg-[#f0b90b]/10 px-3 py-2 text-xs leading-5 text-[#a16207]">
                {report.message ?? '当前结果不是最新月份，请先更新 10q 的 M0 数据。'}
              </div>
            )}
            {!focusedStock && <div className="mt-5">
              <h4 className={`text-sm font-semibold ${primary}`}>本月核心影响因子</h4>
              <div className="mt-2 space-y-2">
                {report.core_factors.map((factor) => (
                  <div key={factor.name} className={`flex items-start justify-between gap-3 border-b pb-2 text-xs ${dark ? 'border-[#30363d]' : 'border-[#e5e7eb]'}`}>
                    <span className={`min-w-0 flex-1 break-all ${primary}`}>{factor.name}</span>
                    <span className={`min-w-0 flex-1 text-right ${secondary}`}>{factor.description} · 影响 {factor.impact.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </div>}
            {!focusedStock && <div className="mt-5 grid gap-5 md:grid-cols-2">
              {(['High', 'Low'] as const).map((tier) => (
                <div key={tier} className="min-w-0 break-words">
                  <h4 className={`text-sm font-semibold ${primary}`}>{tier === 'High' ? '高比例组 · 13%' : '低比例组 · 7%'}</h4>
                  <div className="mt-2 space-y-2">
                    {(tier === 'High' ? report.high : report.low).map((rec) => (
                      <div key={rec.ts_code} onDoubleClick={() => { useStockStore.getState().selectStock(rec.ts_code); onClose(); }} className={`border-b pb-2 text-xs ${dark ? 'border-[#30363d]' : 'border-[#e5e7eb]'}`}>
                        <div className={`font-medium ${primary}`}>{rec.name} <span className={secondary}>{rec.ts_code}</span></div>
                        <p className={`mt-1 leading-5 ${secondary}`}>{rec.attribution ?? '由模型综合因子排序进入组合。'}</p>
                        <details className="mt-2"><summary className={`cursor-pointer ${primary}`}>专业归因</summary><StockAttribution rec={rec} secondary={secondary} /></details>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>}
            {rows.length === 0 && <p className={`mt-4 text-xs ${secondary}`}>暂无可展示的股票归因。</p>}
          </>
        )}
      </div>
    </div>
  );
}

function StockAttribution({ rec, secondary }: { rec: Recommendation; secondary: string }) {
  return <div className={`mt-4 text-xs ${secondary}`}>
    <p className="leading-6">模型得分 {rec.raw_score?.toFixed(6)} · 股票池分位 {rec.score.toFixed(1)}% · 排名 {rec.rank} · 目标比例 {((rec.weight ?? 0) * 100).toFixed(0)}% · 风控后 {((rec.adjusted_weight ?? rec.weight ?? 0) * 100).toFixed(0)}%</p>
    <p className="mb-3 leading-6">TET {rec.m3_action} · Timing {rec.m3_timing?.toFixed(4)} · 基准值 {rec.base_value?.toFixed(6)} · 其余因子贡献 {rec.other_contribution?.toFixed(6)}</p>
    <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b"><th className="py-2">因子</th><th>输入值</th><th className="text-right">模型贡献</th></tr></thead><tbody>
      {rec.factor_contributions?.map(factor => <tr key={factor.name} className="border-b border-current/10"><td className="max-w-48 break-all py-2 pr-3">{factor.name}</td><td className="font-mono">{factor.value.toFixed(3)}</td><td className={`text-right font-mono ${factor.contribution >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{factor.contribution >= 0 ? '+' : ''}{factor.contribution.toFixed(4)}</td></tr>)}
    </tbody></table></div>
  </div>;
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 break-words"><div className="opacity-70">{label}</div><div className="mt-1 font-medium text-current">{value}</div></div>;
}

function formatConfigNumber(value: string | number | boolean | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value ?? '—');
  return value.toFixed(value >= 0.1 ? 3 : 4);
}
