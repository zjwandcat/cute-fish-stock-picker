import { useUIStore } from '@/store/uiStore';

/** 四种评价算法的悬停说明（均 ≤200 字符） */
export const ALGO_TIPS = {
  capital:
    '多因子量化评分（参考高盛/摩根A股多因子框架）：主力净流入率、机构持股、动量、估值（PE/PB/股息率）、低波动等14个因子经横截面标准化后加权合成，资金面权重最高，并叠加T+1短线调整分。适合看主力资金动向做短线选股。',
  fund:
    '基本面评分：PE、PB、股息率、ROE（PB/PE×100估算）等估值与质量因子横截面标准化加权合成。分数越高代表估值越合理、盈利质量越好、股息回报越高，适合防御型高股息长线选股，不追热点。',
  tet:
    '趋势-情绪-时机体系（NAAIM 2025获奖论文）：40个趋势指标（ROC/均线/线性回归×多周期）投票量化趋势方向，12个振荡器合成情绪指数，Timing=锚定趋势−当前情绪。上升趋势中情绪超卖的回调为论文最佳买点，|Timing|≥1.0为显著时机。',
  macdv:
    '波动率归一化动量（SSRN #4099617获奖论文）：MACD-V=(EMA12−EMA26)/ATR26×100，除以波动率后跨股票可比。按±strong/±extreme阈值划分动量生命周期七阶段：金叉且处于复苏区(0~+strong)为买入信号，过热(>+extreme)不追高。',
  double:
    '双指标共振选股：筛选 TET（趋势-情绪-时机）与 MACD-V（波动率归一化动量）同时发出买入信号的股票——两套独立体系互为确认，共振时胜率更高——再按资金面多因子综合评分排序，取前5。分数即为资金面综合分。',
} as const;

interface ModeButtonProps {
  label: string;
  tip: string;
  active: boolean;
  onClick: () => void;
}

/** 算法切换按钮：悬停弹出算法说明（≤200字符），点击切换排序 */
export default function ModeButton({ label, tip, active, onClick }: ModeButtonProps) {
  const { theme } = useUIStore();
  const dark = theme === 'dark';

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-200 whitespace-nowrap active:scale-95 ${
          active
            ? 'bg-[#f0b90b]/15 text-[#f0b90b] border-[#f0b90b]/50'
            : dark
              ? 'bg-[#30363d]/40 text-[#8b949e] border-[#30363d] hover:text-white hover:border-[#8b949e]/50'
              : 'bg-[#e5e7eb]/50 text-[#6b7280] border-[#e5e7eb] hover:text-[#1f2937] hover:border-[#9ca3af]'
        }`}
      >
        {label}
      </button>
      {/* 悬停算法说明 */}
      <div
        className="absolute right-0 top-full mt-2 w-80 max-w-[85vw] p-3 rounded-xl text-xs leading-relaxed opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 pointer-events-none z-50 shadow-2xl"
        style={{
          background: dark ? '#1c2128' : '#ffffff',
          border: dark ? '1px solid #30363d' : '1px solid #e5e7eb',
          color: dark ? '#c9d1d9' : '#374151',
        }}
      >
        <div className="font-bold mb-1" style={{ color: '#f0b90b' }}>
          {label}评分说明
        </div>
        {tip}
      </div>
    </div>
  );
}
