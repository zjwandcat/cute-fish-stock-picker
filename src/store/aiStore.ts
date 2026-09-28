import { create } from 'zustand';
import { aiRequest } from '@/services/ai';
import type { AiConfigView } from '@/types/ai';

interface AiState {
  config: AiConfigView | null;
  configError: string;
  panelOpen: boolean;
  settingsOpen: boolean;
  contextCode: string;
  setPanelOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setContextCode: (code: string) => void;
  loadConfig: () => Promise<void>;
  saveConfig: (input: Record<string, unknown>) => Promise<void>;
}

export const useAiStore = create<AiState>((set) => ({
  config: null,
  configError: '',
  panelOpen: false,
  settingsOpen: false,
  contextCode: '',
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setContextCode: (contextCode) => set({ contextCode }),
  loadConfig: async () => {
    try {
      set({ config: await aiRequest<AiConfigView>('/config'), configError: '' });
    } catch (error) {
      set({ configError: (error as Error).message });
    }
  },
  saveConfig: async (input) => {
    const config = await aiRequest<AiConfigView>('/config', { method: 'PUT', body: JSON.stringify(input) });
    set({ config, configError: '' });
  },
}));
