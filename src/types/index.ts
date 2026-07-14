// ── Tier Definitions ──

export interface TierDefinition {
  id: string;
  name: string;
  color: string;
}

export const DEFAULT_TIER_DEFS: TierDefinition[] = [
  { id: 'S', name: 'S', color: '#ff7f7f' },
  { id: 'A', name: 'A', color: '#ffbf7f' },
  { id: 'B', name: 'B', color: '#ffdf7f' },
  { id: 'C', name: 'C', color: '#ffff7f' },
  { id: 'D', name: 'D', color: '#7fff7f' },
  { id: 'F', name: 'F', color: '#bf7fbf' },
];

// ── Core Models ──

export interface Character {
  id: string;
  tierListId: string;
  name: string;
  imageId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TierAssignment {
  characterId: string;
  tier: string;
  position: number;
}

/**
 * 'graph' (default, also what undefined means on pre-existing rows) — full
 * relationship graph with constraint enforcement. 'simple' — a plain tier
 * list: free drag-and-drop, no relationships, no enforcement engine.
 */
export type TierListMode = 'graph' | 'simple';

export interface TierList {
  id: string;
  name: string;
  description?: string;
  mode?: TierListMode;
  tierDefs: TierDefinition[];
  tiers: TierAssignment[];
  createdAt: number;
  updatedAt: number;
}

export interface Relationship {
  id: string;
  tierListId: string;
  superiorId: string;
  inferiorId: string;
  /** true = must be in a strictly higher tier (>), false = same tier OK (>=) */
  strict: boolean;
  note?: string;
  createdAt: number;
}

export interface ImageBlob {
  id: string;
  blob: Blob;
  mimeType: string;
  originalFilename: string;
  createdAt: number;
}

export type AppView = 'tierlist' | 'relationships';
export type LayoutMode = 'triple' | 'tabs';

export interface Inconsistency {
  type: 'placement' | 'cycle';
  message: string;
  characterIds: string[];
  relationshipIds?: string[];
}
