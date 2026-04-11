import { create } from 'zustand';
import type { AppView } from '../types';

interface UIState {
  activeView: AppView;
  selectedCharacterId: string | null;
  setActiveView: (view: AppView) => void;
  selectCharacter: (id: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeView: 'tierlist',
  selectedCharacterId: null,
  setActiveView: (view) => set({ activeView: view }),
  selectCharacter: (id) => set({ selectedCharacterId: id }),
}));
