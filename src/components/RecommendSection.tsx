import { useStockStore, type RecommendationMode } from '@/store/stockStore';
import { useUIStore } from '@/store/uiStore';
import ModeButton, { ALGO_TIPS } from './ModeButton';

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
  const recommendations = useStockStore((s) => s.recommendations) ?? [];
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
  const isEmpty = !recommendations || recommendations.length === 0;
  if (isEmpty && recommendationMode !== 'double') return null;

  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[#f0b90b] text-lg">★</span>
        <h2 className={`text-base font-bold ${textPrimary}`} style={{ fontFamily: '"Noto Sans SC", sans-serif' }}>
          今日推荐买入
        </h2>
        <span className={`text-xs ${textSecondary} ml-2`}>{today}</span>
        <div className="flex items-center gap-1.5 ml-auto">
          {REC_MODES.map((m) => (
            <ModeButton
              key={m.key}
              label={m.label}
              tip={m.tip}
              active={recommendationMode === m.key}
              onClick={() => setRecommendationMode(m.key)}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-3 scrollbar-thin">
        {isEmpty && (
          <div className={`w-full p-6 rounded-xl ${cardBg} border ${border} text-center text-sm ${textSecondary}`}>
            当前股池中没有 TET 与 MACD-V 同时发出买入信号的股票，可切换其他模式查看
          </div>
        )}
        {recommendations.map((rec) => (
          <div
            key={rec.ts_code}
            onClick={() => selectStock(rec.ts_code)}
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

            <div className="space-y-2 mb-3">
              <ScoreBar label="技术面" score={rec.tech_score} />
              <ScoreBar label="基本面" score={rec.fund_score} />
              <ScoreBar label="资金面" score={rec.capital_score} />
            </div>

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
