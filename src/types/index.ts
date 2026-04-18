export type TierRank = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export const TIER_RANKS: TierRank[] = ['S', 'A', 'B', 'C', 'D', 'F'];

export const TIER_COLORS: Record<TierRank, string> = {
  S: 'var(--tier-s)',
  A: 'var(--tier-a)',
  B: 'var(--tier-b)',
  C: 'var(--tier-c)',
  D: 'var(--tier-d)',
  F: 'var(--tier-f)',
};

export interface Character {
  id: string;
  name: string;
  imageId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TierAssignment {
  characterId: string;
  tier: TierRank;
  position: number;
}

export interface TierList {
  id: string;
  name: string;
  description?: string;
  tiers: TierAssignment[];
  createdAt: number;
  updatedAt: number;
}

export interface Relationship {
  id: string;
  superiorId: string;
  inferiorId: string;
  /** true = must be in a strictly higher tier (>), false = same tier OK (>=) */
  strict: boolean;
  evidenceIds: string[];
  note?: string;
  createdAt: number;
}

export type EvidenceKind = 'feat' | 'statement' | 'title';

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  characterIds: string[];
  relationshipIds: string[];
  text: string;
  source?: string;
  createdAt: number;
}

export interface ImageBlob {
  id: string;
  blob: Blob;
  mimeType: string;
  originalFilename: string;
  createdAt: number;
}

export type AppView = 'tierlist' | 'relationships' | 'evidence';

/** 'triple' = all 3 panels, 'split' = tier list + tabbed right pane, 'tabs' = one view at a time */
export type LayoutMode = 'triple' | 'split' | 'tabs';

export interface Inconsistency {
  type: 'placement' | 'cycle';
  message: string;
  characterIds: string[];
  relationshipIds?: string[];
}
