import { useEffect } from 'react';
import { useStockStore } from '@/store/stockStore';
import { useUIStore } from '@/store/uiStore';
import Navbar from '@/components/Navbar';
import RecommendSection from '@/components/RecommendSection';
import HoldingsSection from '@/components/HoldingsSection';
import StockTable from '@/components/StockTable';
import DetailPanel from '@/components/DetailPanel';
import AlertPanel from '@/components/AlertPanel';

export default function Home() {
  const startAutoRefresh = useStockStore((s) => s.startAutoRefresh);
  const { theme, fontSize } = useUIStore();

  useEffect(() => {
    const cleanup = startAutoRefresh();
    return cleanup;
  }, [startAutoRefresh]);

  // 字体档位（px）
  const fontSizePx = fontSize === 'small' ? 20 : fontSize === 'large' ? 28 : 26;

  // 布局基准（rem）与字体保持小档的比例（14/16=0.875）同步缩放，
  // 这样中/大档的间距、内边距、行高比例与小档完全一致，不会拥挤
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--base-font-size', `${fontSizePx}px`);
    root.style.fontSize = `${Math.round(fontSizePx * 0.875 * 10) / 10}px`;
  }, [fontSizePx]);

  return (
    <div
      className={`min-h-screen transition-colors ${
        theme === 'dark' ? 'bg-[#0d1117] text-white' : 'bg-[#faf9f5] text-[#1f2937]'
      }`}
    >
      <Navbar />
      <main className="pt-14 px-6 max-w-[1600px] mx-auto">
        <div className="py-6">
          <RecommendSection />
          <HoldingsSection />
          <StockTable />
        </div>
      </main>
      <DetailPanel />
      <AlertPanel />
    </div>
  );
}
