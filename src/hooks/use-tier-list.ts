import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { TierList, TierAssignment, TierRank } from '../types';

const DEFAULT_TIER_LIST_ID = 'default';

export function useTierList(): TierList | undefined {
  return useLiveQuery(() => db.tierLists.get(DEFAULT_TIER_LIST_ID), []);
}

export async function ensureTierList(): Promise<TierList> {
  const existing = await db.tierLists.get(DEFAULT_TIER_LIST_ID);
  if (existing) return existing;

  const now = Date.now();
  const tierList: TierList = {
    id: DEFAULT_TIER_LIST_ID,
    name: 'My Tier List',
    tiers: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.tierLists.add(tierList);
  return tierList;
}

export async function updateTierAssignments(tiers: TierAssignment[]): Promise<void> {
  await ensureTierList();
  await db.tierLists.update(DEFAULT_TIER_LIST_ID, {
    tiers,
    updatedAt: Date.now(),
  });
}

export async function assignCharacterToTier(
  characterId: string,
  tier: TierRank,
  position: number,
): Promise<void> {
  const tierList = await ensureTierList();
  const tiers = tierList.tiers.filter((t) => t.characterId !== characterId);
  tiers.push({ characterId, tier, position });
  await updateTierAssignments(tiers);
}

export async function removeFromTier(characterId: string): Promise<void> {
  const tierList = await ensureTierList();
  const tiers = tierList.tiers.filter((t) => t.characterId !== characterId);
  await updateTierAssignments(tiers);
}

export async function updateTierListName(name: string): Promise<void> {
  await ensureTierList();
  await db.tierLists.update(DEFAULT_TIER_LIST_ID, { name, updatedAt: Date.now() });
}
