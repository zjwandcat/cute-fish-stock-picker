import { useEffect, useState } from 'react';
import { Bell, X, Volume2, VolumeX, Trash2, Zap, Target, TrendingDown, Sparkles, Activity } from 'lucide-react';
import { useAlertStore } from '@/store/alertStore';
import type { AlertItem, AlertType, AlertPriority } from '@/types/alert';

const TYPE_LABEL: Record<AlertType, string> = {
  dip: '跌深',
  bottom: '底部',
  rebound: '反弹',
  volume: '异动',
  target: '目标',
};

const TYPE_ICON: Record<AlertType, typeof TrendingDown> = {
  dip: TrendingDown,
  bottom: Sparkles,
  rebound: TrendingDown,
  volume: Activity,
  target: Target,
};

const PRIORITY_COLOR: Record<AlertPriority, string> = {
  high: 'border-l-[#ff4757] bg-[#ff4757]/5',
  medium: 'border-l-[#f0b90b] bg-[#f0b90b]/5',
  low: 'border-l-[#8b949e] bg-[#8b949e]/5',
};

const PRIORITY_BADGE: Record<AlertPriority, string> = {
  high: 'bg-[#ff4757]/20 text-[#ff4757]',
  medium: 'bg-[#f0b90b]/20 text-[#f0b90b]',
  low: 'bg-[#8b949e]/20 text-[#8b949e]',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

interface AlertItemRowProps {
  alert: AlertItem;
  onSetTarget: (tsCode: string, name: string) => void;
}

function AlertItemRow({ alert, onSetTarget }: AlertItemRowProps) {
  const Icon = TYPE_ICON[alert.type];
  return (
    <div
      className={`p-3 rounded-lg border-l-2 border-r border-y border-[#30363d]/50 ${PRIORITY_COLOR[alert.priority]} hover:bg-[#1c2333] transition cursor-pointer`}
      onClick={() => onSetTarget(alert.ts_code, alert.name)}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 text-[#8b949e] flex-shrink-0" />
          <span className="text-sm font-medium text-white truncate">{alert.title}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${PRIORITY_BADGE[alert.priority]}`}>
            {alert.priority.toUpperCase()}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#30363d] text-[#8b949e]">
            {TYPE_LABEL[alert.type]}
          </span>
        </div>
      </div>
      <div className="text-xs text-[#8b949e] mb-1.5">{alert.message}</div>
      <div className="text-xs text-[#00d4aa] mb-1.5">💡 {alert.suggestion}</div>
      <div className="flex items-center justify-between text-[10px] text-[#8b949e]">
        <span>{formatTime(alert.created_at)}</span>
        <span className="hover:text-[#00d4aa]">点击设置目标价 →</span>
      </div>
    </div>
  );
}

interface TargetDialogProps {
  tsCode: string;
  name: string;
  onClose: () => void;
}

function TargetDialog({ tsCode, name, onClose }: TargetDialogProps) {
  const { targets, setTarget } = useAlertStore();
  const current = targets[tsCode] ?? {};
  const [buy, setBuy] = useState<string>(current.buy?.toString() ?? '');
  const [stopLoss, setStopLoss] = useState<string>(current.stop_loss?.toString() ?? '');

  const handleSave = async () => {
    await setTarget(tsCode, {
      buy: buy ? Number(buy) : undefined,
      stop_loss: stopLoss ? Number(stopLoss) : undefined,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 w-[400px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-medium text-white">设置 {name} 目标价</h3>
          <button onClick={onClose} className="text-[#8b949e] hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[#8b949e] mb-1">目标买入价（达到时提醒）</label>
            <input
              type="number"
              step="0.01"
              value={buy}
              onChange={(e) => setBuy(e.target.value)}
              placeholder="例: 65.00"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-[#00d4aa]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#8b949e] mb-1">止损价（达到时提醒）</label>
            <input
              type="number"
              step="0.01"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              placeholder="例: 60.00"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-[#ff4757]"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded bg-[#30363d] text-white text-sm hover:bg-[#3d4759]"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-3 py-2 rounded bg-[#00d4aa] text-[#0d1117] text-sm font-medium hover:bg-[#00b894]"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AlertPanel() {
  const {
    alerts,
    unreadCount,
    browserNotifyEnabled,
    soundEnabled,
    setBrowserNotify,
    setSoundEnabled,
    fetchAlerts,
    fetchTargets,
    triggerAnalyze,
    clearAlerts,
    setUnread,
  } = useAlertStore();

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | AlertPriority>('all');
  const [targetStock, setTargetStock] = useState<{ code: string; name: string } | null>(null);

  useEffect(() => {
    fetchAlerts(true);
    fetchTargets();
    const timer = setInterval(() => fetchAlerts(true), 30000); // 30秒自动分析
    return () => clearInterval(timer);
  }, [fetchAlerts, fetchTargets]);

  // 请求通知权限
  const requestNotify = async () => {
    if (!('Notification' in window)) {
      alert('当前浏览器不支持通知');
      return;
    }
    if (Notification.permission === 'granted') {
      setBrowserNotify(!browserNotifyEnabled);
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      setBrowserNotify(true);
      new Notification('🔔 通知已开启', { body: '可爱鱼儿将在建仓时机出现时通知你' });
    }
  };

  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.priority === filter);
  const highCount = alerts.filter(a => a.priority === 'high').length;

  return (
    <>
      {/* 浮动按钮 */}
      <button
        onClick={() => {
          setOpen(!open);
          setUnread(0);
        }}
        className="fixed top-20 right-4 z-50 bg-[#161b22] border border-[#30363d] rounded-full p-3 shadow-lg hover:bg-[#1c2333] transition relative"
      >
        <Bell className="w-5 h-5 text-[#00d4aa]" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-[#ff4757] text-white text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-medium">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
        {highCount > 0 && (
          <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-[#f0b90b] rounded-full animate-pulse" />
        )}
      </button>

      {/* 面板 */}
      {open && (
        <div className="fixed top-20 right-4 z-50 w-[420px] max-h-[80vh] bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl flex flex-col">
          {/* 头部 */}
          <div className="flex items-center justify-between p-4 border-b border-[#30363d]">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#f0b90b]" />
              <h3 className="text-sm font-medium text-white">盯盘提醒</h3>
              <span className="text-xs text-[#8b949e]">({alerts.length})</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => triggerAnalyze()}
                className="p-1.5 rounded hover:bg-[#30363d] text-[#8b949e] hover:text-white"
                title="立即分析"
              >
                <Activity className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={requestNotify}
                className={`p-1.5 rounded hover:bg-[#30363d] ${browserNotifyEnabled ? 'text-[#00d4aa]' : 'text-[#8b949e]'}`}
                title="浏览器通知"
              >
                <Bell className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`p-1.5 rounded hover:bg-[#30363d] ${soundEnabled ? 'text-[#00d4aa]' : 'text-[#8b949e]'}`}
                title="声音"
              >
                {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => clearAlerts()}
                className="p-1.5 rounded hover:bg-[#30363d] text-[#8b949e] hover:text-[#ff4757]"
                title="清空"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded hover:bg-[#30363d] text-[#8b949e] hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 筛选 */}
          <div className="flex gap-1 p-2 border-b border-[#30363d]">
            {[
              { v: 'all' as const, l: '全部' },
              { v: 'high' as AlertPriority, l: `高优 ${alerts.filter(a => a.priority === 'high').length}` },
              { v: 'medium' as AlertPriority, l: `中 ${alerts.filter(a => a.priority === 'medium').length}` },
            ].map(item => (
              <button
                key={item.v}
                onClick={() => setFilter(item.v)}
                className={`px-2.5 py-1 text-xs rounded ${
                  filter === item.v
                    ? 'bg-[#00d4aa] text-[#0d1117] font-medium'
                    : 'bg-[#30363d] text-[#8b949e] hover:text-white'
                }`}
              >
                {item.l}
              </button>
            ))}
          </div>

          {/* 列表 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-[#8b949e] text-sm">
                暂无提醒
                <div className="text-xs mt-1 text-[#8b949e]/60">点击右上角"立即分析"开始扫描</div>
              </div>
            ) : (
              filtered.map(alert => (
                <AlertItemRow
                  key={alert.id}
                  alert={alert}
                  onSetTarget={(code, name) => setTargetStock({ code, name })}
                />
              ))
            )}
          </div>

          {/* 底部说明 */}
          <div className="p-3 border-t border-[#30363d] text-[10px] text-[#8b949e] space-y-0.5">
            <div>📉 跌深：单日跌幅≥4% | 💎 底部：缩量+低估 | 🚀 反弹：放量上涨</div>
            <div>⚡ 异动：量比≥2 | 🎯 目标：到达预设价</div>
          </div>
        </div>
      )}

      {/* 目标价设置弹窗 */}
      {targetStock && (
        <TargetDialog
          tsCode={targetStock.code}
          name={targetStock.name}
          onClose={() => setTargetStock(null)}
        />
      )}
    </>
  );
}
