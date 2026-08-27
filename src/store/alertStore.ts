import { create } from 'zustand';
import type { AlertItem, UserTargets } from '@/types/alert';

interface AlertStore {
  alerts: AlertItem[];
  targets: UserTargets;
  unreadCount: number;
  browserNotifyEnabled: boolean;
  soundEnabled: boolean;
  loading: boolean;

  setAlerts: (alerts: AlertItem[]) => void;
  setTargets: (t: UserTargets) => void;
  setBrowserNotify: (v: boolean) => void;
  setSoundEnabled: (v: boolean) => void;
  setUnread: (n: number) => void;

  fetchAlerts: (refresh?: boolean) => Promise<void>;
  fetchTargets: () => Promise<void>;
  setTarget: (tsCode: string, t: { buy?: number; stop_loss?: number; alert_pct?: number }) => Promise<void>;
  clearAlerts: () => Promise<void>;
  triggerAnalyze: () => Promise<void>;
  notify: (alert: AlertItem) => void;
}

const SEEN_KEY = 'seen_alert_ids';
const NOTIFY_KEY = 'browser_notify_enabled';
const SOUND_KEY = 'sound_enabled';

function getSeenIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function addSeenIds(ids: string[]) {
  const seen = getSeenIds();
  ids.forEach(id => seen.add(id));
  // 只保留最近200条
  const arr = Array.from(seen).slice(-200);
  localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
}

export const useAlertStore = create<AlertStore>((set, get) => ({
  alerts: [],
  targets: {},
  unreadCount: 0,
  browserNotifyEnabled: localStorage.getItem(NOTIFY_KEY) === '1',
  soundEnabled: localStorage.getItem(SOUND_KEY) === '1',
  loading: false,

  setAlerts: (alerts) => set({ alerts }),
  setTargets: (targets) => set({ targets }),
  setBrowserNotify: (v) => {
    localStorage.setItem(NOTIFY_KEY, v ? '1' : '0');
    set({ browserNotifyEnabled: v });
  },
  setSoundEnabled: (v) => {
    localStorage.setItem(SOUND_KEY, v ? '1' : '0');
    set({ soundEnabled: v });
  },
  setUnread: (unreadCount) => set({ unreadCount }),

  fetchAlerts: async (refresh = false) => {
    set({ loading: true });
    try {
      const r = await fetch(`/api/alerts?refresh=${refresh ? '1' : '0'}`);
      const j = await r.json();
      const newAlerts: AlertItem[] = j.data || [];
      const prevIds = getSeenIds();
      const trulyNew = newAlerts.filter(a => !prevIds.has(a.id));

      // 触发浏览器通知
      if (get().browserNotifyEnabled && trulyNew.length > 0) {
        for (const a of trulyNew.slice(0, 3)) {
          get().notify(a);
        }
      }

      addSeenIds(newAlerts.map(a => a.id));
      set({ alerts: newAlerts, unreadCount: trulyNew.length });
    } catch (err) {
      console.error('获取告警失败', err);
    } finally {
      set({ loading: false });
    }
  },

  fetchTargets: async () => {
    try {
      const r = await fetch('/api/alerts/targets');
      const j = await r.json();
      set({ targets: j.data || {} });
    } catch (err) {
      console.error('获取目标价失败', err);
    }
  },

  setTarget: async (tsCode, t) => {
    try {
      await fetch('/api/alerts/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ts_code: tsCode, ...t }),
      });
      await get().fetchTargets();
    } catch (err) {
      console.error('设置目标价失败', err);
    }
  },

  clearAlerts: async () => {
    try {
      await fetch('/api/alerts', { method: 'DELETE' });
      set({ alerts: [], unreadCount: 0 });
    } catch (err) {
      console.error('清空告警失败', err);
    }
  },

  triggerAnalyze: async () => {
    set({ loading: true });
    try {
      await fetch('/api/alerts/analyze', { method: 'POST' });
      await get().fetchAlerts(false);
    } finally {
      set({ loading: false });
    }
  },

  notify: (alert) => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const n = new Notification(alert.title, {
      body: `${alert.message}\n💡 ${alert.suggestion}`,
      tag: alert.id,
      icon: '/favicon.ico',
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };

    // 声音提示
    if (get().soundEnabled && alert.priority === 'high') {
      try {
        const audio = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
        audio.play().catch(() => {});
      } catch {
        // 忽略音频播放失败（非关键路径）
      }
    }
  },
}));
