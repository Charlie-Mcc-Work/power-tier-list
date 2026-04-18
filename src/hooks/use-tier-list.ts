import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { TierList, TierAssignment, TierRank } from '../types';
import { autoPlaceAndEnforce } from '../lib/enforce-constraints';

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

/**
 * Auto-place unranked characters that have relationships, and
 * enforce all constraints. Called after adding/removing relationships.
 */
export async function enforceAndAutoPlace(): Promise<void> {
  const [relationships, tierList, characters] = await Promise.all([
    db.relationships.toArray(),
    ensureTierList(),
    db.characters.toArray(),
  ]);

  const allCharIds = new Set(characters.map((c) => c.id));
  const newAssignments = autoPlaceAndEnforce(tierList.tiers, relationships, allCharIds);

  // Only write if something actually changed
  if (
    newAssignments.length !== tierList.tiers.length ||
    newAssignments.some((a, i) => {
      const orig = tierList.tiers[i];
      return !orig || orig.characterId !== a.characterId || orig.tier !== a.tier || orig.position !== a.position;
    })
  ) {
    await updateTierAssignments(newAssignments);
  }
}
