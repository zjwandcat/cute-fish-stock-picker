import { create } from 'zustand';
import type { StockQuote, StockDetail, DailyBar, NewsItem, Recommendation, MonthlyReport } from '@/types/stock';

/** 今日推荐排序模式：capital=资金面综合评分 / tet=TET买入信号 / macdv=MACD-V买入信号 / double=双指标共振 */
export type RecommendationMode = 'capital' | 'tet' | 'macdv' | 'double';

interface DetailData {
  detail: StockDetail;
  daily: DailyBar[];
  news: NewsItem[];
}

interface StockState {
  stocks: StockQuote[];
  recommendations: Recommendation[];
  monthlyRecommendations: Recommendation[];
  monthlyReport: MonthlyReport | null;
  monthlyLoading: boolean;
  recommendationView: 'daily' | 'monthly';
  recommendationMode: RecommendationMode;
  selectedStock: string | null;
  detailData: DetailData | null;
  lastRefresh: number;
  countdown: number;
  loading: boolean;
  fetchStocks: () => Promise<void>;
  fetchRecommendations: () => Promise<void>;
  fetchMonthlyRecommendations: (force?: boolean) => Promise<void>;
  setRecommendationView: (view: 'daily' | 'monthly') => void;
  setRecommendationMode: (mode: RecommendationMode) => void;
  selectStock: (code: string) => void;
  closeStock: () => void;
  fetchDetail: (code: string) => Promise<void>;
  fetchDaily: (code: string) => Promise<void>;
  fetchNews: (code: string) => Promise<void>;
  refresh: () => Promise<void>;
  startAutoRefresh: () => () => void;
  tick: () => void;
  addStock: (code: string) => Promise<{ success: boolean; message?: string }>;
  removeStock: (code: string) => Promise<{ success: boolean; message?: string }>;
}

export const useStockStore = create<StockState>((set, get) => {
  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  return {
    stocks: [],
    recommendations: [],
    monthlyRecommendations: [],
    monthlyReport: null,
    monthlyLoading: false,
    recommendationView: 'daily',
    recommendationMode: 'capital',
    selectedStock: null,
    detailData: null,
    lastRefresh: 0,
    countdown: 30,
    loading: false,

    fetchStocks: async () => {
      try {
        const res = await fetch('/api/stocks');
        const data = await res.json();
        const stocks: StockQuote[] = Array.isArray(data) ? data : data.data ?? [];
        stocks.sort((a, b) => (b.total_mv ?? -1) - (a.total_mv ?? -1));
        set({ stocks });
      } catch (err) {
        console.error('fetchStocks error:', err);
      }
    },

    fetchRecommendations: async () => {
      try {
        const mode = get().recommendationMode;
        const res = await fetch(`/api/recommendations?mode=${mode}`);
        const data = await res.json();
        set({ recommendations: Array.isArray(data) ? data : data.data ?? [] });
      } catch (err) {
        console.error('fetchRecommendations error:', err);
      }
    },
    fetchMonthlyRecommendations: async (force = false) => {
      if (get().monthlyLoading) return;
      set({ monthlyLoading: true });
      try {
        const res = await fetch(`/api/recommendations/monthly?limit=10${force ? '&refresh=1' : ''}`);
        const data = await res.json();
        const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' })
          .formatToParts(new Date());
        const currentMonth = `${parts.find(part => part.type === 'year')!.value}${parts.find(part => part.type === 'month')!.value}`;
        const ready = data.success && data.report?.status === 'ready' && data.report?.recommendation_month === currentMonth;
        set({ monthlyRecommendations: ready ? data.data ?? [] : [], monthlyReport: data.report ?? null });
      } catch (err) {
        console.error('fetchMonthlyRecommendations error:', err);
        set({ monthlyRecommendations: [], monthlyReport: {
          status: 'error', model: '10q Trial 157', scheme: 'scheme_b', pipeline: [],
          config: {}, core_factors: [], high: [], low: [], message: '月度计算连接失败，请检查本机服务后重试。',
        } });
      } finally {
        set({ monthlyLoading: false });
      }
    },
    setRecommendationView: (view) => { set({ recommendationView: view }); if (view === 'monthly') get().fetchMonthlyRecommendations(); },

    setRecommendationMode: (mode: RecommendationMode) => {
      if (get().recommendationMode === mode) return;
      set({ recommendationMode: mode });
      get().fetchRecommendations();
    },

    selectStock: (code: string) => {
      set({ selectedStock: code, detailData: null });
      get().fetchDetail(code);
      get().fetchDaily(code);
      get().fetchNews(code);
    },

    closeStock: () => {
      set({ selectedStock: null, detailData: null });
    },

    fetchDetail: async (code: string) => {
      try {
        const res = await fetch(`/api/stocks/${code}/detail`);
        const data = await res.json();
        const detail: StockDetail = data.data ?? data;
        set((state) => ({
          detailData: state.detailData
            ? { ...state.detailData, detail }
            : { detail, daily: [], news: [] },
        }));
      } catch (err) {
        console.error('fetchDetail error:', err);
      }
    },

    fetchDaily: async (code: string) => {
      try {
        const res = await fetch(`/api/stocks/${code}/daily?limit=250`);
        const data = await res.json();
        const daily: DailyBar[] = Array.isArray(data) ? data : data.data ?? [];
        set((state) => ({
          detailData: state.detailData
            ? { ...state.detailData, daily }
            : { detail: {} as StockDetail, daily, news: [] },
        }));
      } catch (err) {
        console.error('fetchDaily error:', err);
      }
    },

    fetchNews: async (code: string) => {
      try {
        const res = await fetch(`/api/stocks/${code}/news`);
        const data = await res.json();
        const news: NewsItem[] = Array.isArray(data) ? data : data.data ?? [];
        set((state) => ({
          detailData: state.detailData
            ? { ...state.detailData, news }
            : { detail: {} as StockDetail, daily: [], news },
        }));
      } catch (err) {
        console.error('fetchNews error:', err);
      }
    },

    refresh: async () => {
      set({ loading: true });
      const { selectedStock } = get();
      await Promise.all([
        get().fetchStocks(),
        get().fetchRecommendations(),
      ]);
      if (selectedStock) {
        await Promise.all([
          get().fetchDetail(selectedStock),
          get().fetchDaily(selectedStock),
          get().fetchNews(selectedStock),
        ]);
      }
      set({ lastRefresh: Date.now(), countdown: 30, loading: false });
    },

    startAutoRefresh: () => {
      if (countdownTimer) clearInterval(countdownTimer);

      get().refresh();

      countdownTimer = setInterval(() => {
        get().tick();
      }, 1000);

      return () => {
        if (countdownTimer) {
          clearInterval(countdownTimer);
          countdownTimer = null;
        }
      };
    },

    tick: () => {
      const { countdown } = get();
      if (countdown <= 1) {
        get().refresh();
      } else {
        set({ countdown: countdown - 1 });
      }
    },

    addStock: async (code: string) => {
      try {
        const res = await fetch('/api/stocks/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (data.success) {
          await get().refresh();
          return { success: true };
        }
        return { success: false, message: data.message };
      } catch (err) {
        console.error('addStock error:', err);
        return { success: false, message: '网络错误' };
      }
    },

    removeStock: async (code: string) => {
      try {
        const res = await fetch(`/api/stocks/${code}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          // 如果删除的是当前选中的股票，关闭详情
          if (get().selectedStock === code) {
            set({ selectedStock: null, detailData: null });
          }
          await get().refresh();
          return { success: true };
        }
        return { success: false, message: data.message };
      } catch (err) {
        console.error('removeStock error:', err);
        return { success: false, message: '网络错误' };
      }
    },
  };
});
