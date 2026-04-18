import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { TierList, TierAssignment } from '../types';
import { DEFAULT_TIER_DEFS } from '../types';
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
    tierDefs: DEFAULT_TIER_DEFS,
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
    tierDefs: DEFAULT_TIER_DEFS,
    tiers: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.tierLists.add(tierList);
  return tierList;
}

export async function deleteTierList(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.tierLists, db.characters, db.relationships, db.evidence, db.images],
    async () => {
      // Delete all characters (and their images) belonging to this list
      const chars = await db.characters.where('tierListId').equals(id).toArray();
      const imageIds = chars.map((c) => c.imageId).filter((i): i is string => !!i);
      if (imageIds.length > 0) await db.images.bulkDelete(imageIds);
      await db.characters.where('tierListId').equals(id).delete();

      // Delete all relationships and evidence belonging to this list
      await db.relationships.where('tierListId').equals(id).delete();
      await db.evidence.where('tierListId').equals(id).delete();

      // Delete the tier list itself
      await db.tierLists.delete(id);
    },
  );
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
  tier: string,
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
    db.relationships.where('tierListId').equals(activeTierListId).toArray(),
    ensureTierList(),
    db.characters.where('tierListId').equals(activeTierListId).toArray(),
  ]);

  const tierDefs = tierList.tierDefs ?? DEFAULT_TIER_DEFS;
  const tierIds = tierDefs.map((t) => t.id);
  const allCharIds = new Set(characters.map((c) => c.id));
  const newAssignments = autoPlaceAndEnforce(tierList.tiers, relationships, allCharIds, tierIds);

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

// ── Tier definition management ──

export async function addTierDef(name: string, color: string): Promise<void> {
  const tierList = await ensureTierList();
  const tierDefs = [...(tierList.tierDefs ?? DEFAULT_TIER_DEFS)];
  const id = crypto.randomUUID();
  tierDefs.push({ id, name, color });
  await db.tierLists.update(activeTierListId, { tierDefs, updatedAt: Date.now() });
}

export async function removeTierDef(tierId: string): Promise<void> {
  const tierList = await ensureTierList();
  const tierDefs = (tierList.tierDefs ?? DEFAULT_TIER_DEFS).filter((t) => t.id !== tierId);
  // Also remove any assignments in that tier
  const tiers = tierList.tiers.filter((a) => a.tier !== tierId);
  await db.tierLists.update(activeTierListId, { tierDefs, tiers, updatedAt: Date.now() });
}

export async function renameTierDef(tierId: string, name: string): Promise<void> {
  const tierList = await ensureTierList();
  const tierDefs = (tierList.tierDefs ?? DEFAULT_TIER_DEFS).map((t) =>
    t.id === tierId ? { ...t, name } : t,
  );
  await db.tierLists.update(activeTierListId, { tierDefs, updatedAt: Date.now() });
}

export async function recolorTierDef(tierId: string, color: string): Promise<void> {
  const tierList = await ensureTierList();
  const tierDefs = (tierList.tierDefs ?? DEFAULT_TIER_DEFS).map((t) =>
    t.id === tierId ? { ...t, color } : t,
  );
  await db.tierLists.update(activeTierListId, { tierDefs, updatedAt: Date.now() });
}

export async function reorderTierDefs(tierIds: string[]): Promise<void> {
  const tierList = await ensureTierList();
  const defsMap = new Map((tierList.tierDefs ?? DEFAULT_TIER_DEFS).map((t) => [t.id, t]));
  const tierDefs = tierIds.map((id) => defsMap.get(id)!).filter(Boolean);
  await db.tierLists.update(activeTierListId, { tierDefs, updatedAt: Date.now() });
}
