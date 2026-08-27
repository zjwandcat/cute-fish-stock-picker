import { RefreshCw, Sun, Moon } from 'lucide-react';
import { useStockStore } from '@/store/stockStore';
import { useUIStore } from '@/store/uiStore';

export default function Navbar() {
  const { lastRefresh, countdown, loading, refresh } = useStockStore();
  const { theme, fontSize, toggleTheme, setFontSize } = useUIStore();

  const formatTime = (ts: number) => {
    if (!ts) return '--:--:--';
    const d = new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour12: false });
  };

  const fontSizeClass = fontSize === 'small' ? 'text-xs' : fontSize === 'large' ? 'text-base' : 'text-sm';
  const dark = theme === 'dark';

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-40 h-14 flex items-center justify-between px-6 transition-all duration-300"
      style={{
        background: dark
          ? 'linear-gradient(135deg, rgba(28, 28, 30, 0.85) 0%, rgba(44, 44, 46, 0.75) 100%)'
          : 'linear-gradient(135deg, rgba(255, 255, 255, 0.85) 0%, rgba(245, 245, 247, 0.75) 100%)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        borderBottom: dark
          ? '0.5px solid rgba(255, 255, 255, 0.08)'
          : '0.5px solid rgba(255, 255, 255, 0.6)',
        boxShadow: dark
          ? '0 4px 24px rgba(0, 0, 0, 0.2)'
          : '0 4px 24px rgba(0, 0, 0, 0.06)',
      }}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">🐟</span>
        <h1
          className="text-lg font-bold tracking-wide"
          style={{
            color: dark ? '#fff' : '#1c1c1e',
            fontFamily: '"Noto Sans SC", sans-serif',
          }}
        >
          可爱鱼儿选股指南
        </h1>
      </div>
      <div
        className={`flex items-center gap-4 ${fontSizeClass}`}
        style={{ color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(60,60,67,0.6)' }}
      >
        {/* 字体大小调整 */}
        <div className="flex items-center gap-1">
          {(['small', 'medium', 'large'] as const).map((size) => (
            <button
              key={size}
              onClick={() => setFontSize(size)}
              className={`px-2 py-1 rounded-lg transition-all duration-200 ${
                size === 'small' ? 'text-xs' : size === 'medium' ? 'text-sm' : 'text-base'
              }`}
              style={{
                background:
                  fontSize === size
                    ? dark
                      ? 'rgba(0, 122, 255, 0.15)'
                      : 'rgba(0, 122, 255, 0.1)'
                    : 'transparent',
                color:
                  fontSize === size
                    ? '#007AFF'
                    : dark
                      ? 'rgba(255,255,255,0.6)'
                      : 'rgba(60,60,67,0.6)',
                border:
                  fontSize === size
                    ? dark
                      ? '0.5px solid rgba(0, 122, 255, 0.3)'
                      : '0.5px solid rgba(0, 122, 255, 0.2)'
                    : '0.5px solid transparent',
              }}
            >
              A
            </button>
          ))}
        </div>

        {/* 主题切换 */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-full transition-all duration-200 active:scale-90"
          style={{
            background: dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
          }}
          title={dark ? '切换到浅色模式' : '切换到夜间模式'}
        >
          {dark ? (
            <Sun size={16} className="text-[#FFD60A]" />
          ) : (
            <Moon size={16} className="text-[#007AFF]" />
          )}
        </button>

        <span>
          更新于{' '}
          <span
            className="font-mono"
            style={{ color: dark ? '#fff' : '#1c1c1e' }}
          >
            {formatTime(lastRefresh)}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full animate-pulse"
            style={{ background: '#34C759' }}
          />
          <span className="font-mono text-[#34C759]">{countdown}s</span>
        </span>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-2 rounded-full transition-all duration-200 disabled:opacity-40 active:scale-90"
          style={{
            background: dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
          }}
          title="手动刷新"
        >
          <RefreshCw
            size={16}
            className={`${loading ? 'animate-spin' : ''}`}
            style={{ color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(60,60,67,0.6)' }}
          />
        </button>
      </div>
    </nav>
  );
}
