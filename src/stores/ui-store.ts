import { create } from 'zustand';
import type { AppView, LayoutMode } from '../types';

export type ImageDisplayMode = 'contain' | 'cover';
export type AppPage = 'home' | 'editor';
export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

export const CARD_SIZES: Record<CardSize, { card: number; img: number; text: string; name: string }> = {
  xs: { card: 52, img: 40, text: '8px', name: 'XS' },
  sm: { card: 68, img: 52, text: '9px', name: 'S' },
  md: { card: 80, img: 56, text: '10px', name: 'M' },
  lg: { card: 100, img: 76, text: '11px', name: 'L' },
};

interface UIState {
  page: AppPage;
  activeTierListId: string | null;
  activeView: AppView;
  layoutMode: LayoutMode;
  rightPaneTab: 'relationships' | 'evidence';
  splitPercent: number;
  imageDisplay: ImageDisplayMode;
  cardSize: CardSize;
  presenting: boolean;
  selectedCharacterId: string | null;
  navigateHome: () => void;
  openTierList: (id: string) => void;
  setActiveView: (view: AppView) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setRightPaneTab: (tab: 'relationships' | 'evidence') => void;
  setSplitPercent: (pct: number) => void;
  setImageDisplay: (mode: ImageDisplayMode) => void;
  setCardSize: (size: CardSize) => void;
  setPresenting: (v: boolean) => void;
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
  cardSize: 'md',
  presenting: false,
  selectedCharacterId: null,
  navigateHome: () => set({ page: 'home', activeTierListId: null, selectedCharacterId: null }),
  openTierList: (id) => set({ page: 'editor', activeTierListId: id, selectedCharacterId: null }),
  setActiveView: (view) => set({ activeView: view }),
  setLayoutMode: (mode) => set({ layoutMode: mode }),
  setRightPaneTab: (tab) => set({ rightPaneTab: tab }),
  setSplitPercent: (pct) => set({ splitPercent: Math.min(80, Math.max(20, pct)) }),
  setImageDisplay: (mode) => set({ imageDisplay: mode }),
  setCardSize: (size) => set({ cardSize: size }),
  setPresenting: (v) => set({ presenting: v }),
  selectCharacter: (id) => set({ selectedCharacterId: id }),
}));
