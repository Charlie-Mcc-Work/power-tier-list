import { create } from 'zustand';
import type { AppView, LayoutMode } from '../types';

export type ImageDisplayMode = 'contain' | 'cover';
export type AppPage = 'home' | 'editor';

interface UIState {
  page: AppPage;
  activeTierListId: string | null;
  activeView: AppView;
  layoutMode: LayoutMode;
  rightPaneTab: 'relationships' | 'evidence';
  splitPercent: number;
  imageDisplay: ImageDisplayMode;
  selectedCharacterId: string | null;
  navigateHome: () => void;
  openTierList: (id: string) => void;
  setActiveView: (view: AppView) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setRightPaneTab: (tab: 'relationships' | 'evidence') => void;
  setSplitPercent: (pct: number) => void;
  setImageDisplay: (mode: ImageDisplayMode) => void;
  selectCharacter: (id: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  page: 'home',
  activeTierListId: null,
  activeView: 'tierlist',
  layoutMode: 'triple',
  rightPaneTab: 'relationships',
  splitPercent: 50,
  imageDisplay: 'contain',
  selectedCharacterId: null,
  navigateHome: () => set({ page: 'home', activeTierListId: null, selectedCharacterId: null }),
  openTierList: (id) => set({ page: 'editor', activeTierListId: id, selectedCharacterId: null }),
  setActiveView: (view) => set({ activeView: view }),
  setLayoutMode: (mode) => set({ layoutMode: mode }),
  setRightPaneTab: (tab) => set({ rightPaneTab: tab }),
  setSplitPercent: (pct) => set({ splitPercent: Math.min(80, Math.max(20, pct)) }),
  setImageDisplay: (mode) => set({ imageDisplay: mode }),
  selectCharacter: (id) => set({ selectedCharacterId: id }),
}));
