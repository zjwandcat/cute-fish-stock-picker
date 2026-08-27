import { create } from 'zustand';

export type Theme = 'light' | 'dark';
export type FontSize = 'small' | 'medium' | 'large';

interface UIState {
  theme: Theme;
  fontSize: FontSize;
  toggleTheme: () => void;
  setFontSize: (size: FontSize) => void;
}

// 从 localStorage 读取初始值
function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // 忽略 localStorage 不可用
  }
  return 'light'; // 默认浅色主题
}

function getInitialFontSize(): FontSize {
  try {
    const saved = localStorage.getItem('fontSize');
    if (saved === 'small' || saved === 'medium' || saved === 'large') return saved;
  } catch {
    // 忽略 localStorage 不可用
  }
  return 'medium';
}

export const useUIStore = create<UIState>((set) => ({
  theme: getInitialTheme(),
  fontSize: getInitialFontSize(),
  toggleTheme: () => {
    set((state) => {
      const newTheme = state.theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem('theme', newTheme); } catch {
        // 忽略 localStorage 写入失败
      }
      return { theme: newTheme };
    });
  },
  setFontSize: (size: FontSize) => {
    try { localStorage.setItem('fontSize', size); } catch {
      // 忽略 localStorage 写入失败
    }
    set({ fontSize: size });
  },
}));
