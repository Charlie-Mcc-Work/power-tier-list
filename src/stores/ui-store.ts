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
  splitPercent: number;
  imageDisplay: ImageDisplayMode;
  cardSize: CardSize;
  presenting: boolean;
  showTierCounts: boolean;
  searchQuery: string;
  selectedCharacterId: string | null;
  helpOpen: boolean;
  snapshotsOpen: boolean;
  syncOpen: boolean;
  copyTextOpen: boolean;
  /** Which filter is active in the Relationships panel. */
  relationshipsFilter: 'all' | 'redundant' | 'contradictions';
  navigateHome: () => void;
  openTierList: (id: string) => void;
  setActiveView: (view: AppView) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setSplitPercent: (pct: number) => void;
  setImageDisplay: (mode: ImageDisplayMode) => void;
  setCardSize: (size: CardSize) => void;
  setPresenting: (v: boolean) => void;
  setShowTierCounts: (v: boolean) => void;
  setSearchQuery: (q: string) => void;
  selectCharacter: (id: string | null) => void;
  setHelpOpen: (v: boolean) => void;
  setSnapshotsOpen: (v: boolean) => void;
  setSyncOpen: (v: boolean) => void;
  setCopyTextOpen: (v: boolean) => void;
  setRelationshipsFilter: (filter: 'all' | 'redundant' | 'contradictions') => void;
}

export const useUIStore = create<UIState>((set) => ({
  page: 'home',
  activeTierListId: null,
  activeView: 'tierlist',
  layoutMode: 'triple',
  splitPercent: 50,
  imageDisplay: 'contain',
  cardSize: 'md',
  presenting: false,
  showTierCounts: false,
  searchQuery: '',
  selectedCharacterId: null,
  helpOpen: false,
  snapshotsOpen: false,
  syncOpen: false,
  copyTextOpen: false,
  relationshipsFilter: 'all',
  navigateHome: () => set({ page: 'home', activeTierListId: null, selectedCharacterId: null }),
  openTierList: (id) => set({ page: 'editor', activeTierListId: id, selectedCharacterId: null }),
  setActiveView: (view) => set({ activeView: view }),
  setLayoutMode: (mode) => set({ layoutMode: mode }),
  setSplitPercent: (pct) => set({ splitPercent: Math.min(80, Math.max(20, pct)) }),
  setImageDisplay: (mode) => set({ imageDisplay: mode }),
  setCardSize: (size) => set({ cardSize: size }),
  setPresenting: (v) => set({ presenting: v }),
  setShowTierCounts: (v) => set({ showTierCounts: v }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  selectCharacter: (id) => set({ selectedCharacterId: id }),
  setHelpOpen: (v) => set({ helpOpen: v }),
  setSnapshotsOpen: (v) => set({ snapshotsOpen: v }),
  setSyncOpen: (v) => set({ syncOpen: v }),
  setCopyTextOpen: (v) => set({ copyTextOpen: v }),
  setRelationshipsFilter: (filter) => set({ relationshipsFilter: filter }),
}));
