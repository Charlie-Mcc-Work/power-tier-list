import { create } from 'zustand';
import type { AppView, LayoutMode } from '../types';

interface UIState {
  activeView: AppView;
  layoutMode: LayoutMode;
  /** In split mode, which sub-tab is active in the right pane */
  rightPaneTab: 'relationships' | 'evidence';
  /** Left pane width as a percentage (20–80) */
  splitPercent: number;
  selectedCharacterId: string | null;
  setActiveView: (view: AppView) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setRightPaneTab: (tab: 'relationships' | 'evidence') => void;
  setSplitPercent: (pct: number) => void;
  selectCharacter: (id: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeView: 'tierlist',
  layoutMode: 'triple',
  rightPaneTab: 'relationships',
  splitPercent: 50,
  selectedCharacterId: null,
  setActiveView: (view) => set({ activeView: view }),
  setLayoutMode: (mode) => set({ layoutMode: mode }),
  setRightPaneTab: (tab) => set({ rightPaneTab: tab }),
  setSplitPercent: (pct) => set({ splitPercent: Math.min(80, Math.max(20, pct)) }),
  selectCharacter: (id) => set({ selectedCharacterId: id }),
}));
