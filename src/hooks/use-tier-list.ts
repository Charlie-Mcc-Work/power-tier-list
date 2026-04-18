import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { TierList, TierAssignment, TierRank } from '../types';
import { autoPlaceAndEnforce } from '../lib/enforce-constraints';

// ── Active tier list ID (module-level so all functions share it) ──

let activeTierListId: string = 'default';

export function getActiveTierListId(): string {
  return activeTierListId;
}

export function setActiveTierListId(id: string): void {
  activeTierListId = id;
}

// ── Hooks ──

export function useTierList(): TierList | undefined {
  const id = activeTierListId;
  return useLiveQuery(() => db.tierLists.get(id), [id]);
}

export function useAllTierLists(): TierList[] {
  return useLiveQuery(
    () => db.tierLists.toArray().then((lists) => lists.sort((a, b) => b.updatedAt - a.updatedAt)),
    [],
  ) ?? [];
}

// ── CRUD ──

export async function createTierList(name: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.tierLists.add({
    id,
    name,
    tiers: [],
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function ensureTierList(): Promise<TierList> {
  const existing = await db.tierLists.get(activeTierListId);
  if (existing) return existing;

  const now = Date.now();
  const tierList: TierList = {
    id: activeTierListId,
    name: 'My Tier List',
    tiers: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.tierLists.add(tierList);
  return tierList;
}

export async function deleteTierList(id: string): Promise<void> {
  await db.tierLists.delete(id);
}

export async function updateTierListName(id: string, name: string): Promise<void> {
  await db.tierLists.update(id, { name, updatedAt: Date.now() });
}

// ── Tier assignments ──

export async function updateTierAssignments(tiers: TierAssignment[]): Promise<void> {
  await ensureTierList();
  await db.tierLists.update(activeTierListId, {
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

/**
 * Auto-place unranked characters that have relationships, and
 * enforce all constraints on the active tier list.
 */
export async function enforceAndAutoPlace(): Promise<void> {
  const [relationships, tierList, characters] = await Promise.all([
    db.relationships.toArray(),
    ensureTierList(),
    db.characters.toArray(),
  ]);

  const allCharIds = new Set(characters.map((c) => c.id));
  const newAssignments = autoPlaceAndEnforce(tierList.tiers, relationships, allCharIds);

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
