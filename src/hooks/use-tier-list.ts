import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { TierList, TierAssignment } from '../types';
import { DEFAULT_TIER_DEFS } from '../types';
import { autoPlaceAndEnforce } from '../lib/enforce-constraints';
import { undoManager } from '../lib/undo';
import { useUIStore } from '../stores/ui-store';

// ── Active tier list ID ──
// The Zustand store (useUIStore.activeTierListId) is the single source of truth.
// Hooks subscribe via useUIStore so React re-renders on change.
// Non-hook code paths read via getActiveTierListId(), which is a synchronous
// snapshot of the store — never-null, falling back to 'default' when the user
// is on the home page (where actions shouldn't be invoked anyway).

export function getActiveTierListId(): string {
  return useUIStore.getState().activeTierListId ?? 'default';
}

// ── Hooks ──

export function useTierList(): TierList | undefined {
  const id = useUIStore((s) => s.activeTierListId) ?? 'default';
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
  const id = getActiveTierListId();
  const existing = await db.tierLists.get(id);
  if (existing) return existing;

  const now = Date.now();
  const tierList: TierList = {
    id,
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
  // Figure out which images belonging to this list are referenced by
  // characters in OTHER lists; those must survive the deletion. Without
  // this check, any image id shared across lists (legacy data from before
  // imports started minting fresh ids) gets dragged down with whichever
  // list happens to be deleted first, leaving siblings full of broken
  // imageId refs — the "all question marks" bug.
  const chars = await db.characters.where('tierListId').equals(id).toArray();
  const candidateImageIds = new Set(
    chars.map((c) => c.imageId).filter((i): i is string => !!i),
  );
  let imageIdsToDelete: string[] = [];
  if (candidateImageIds.size > 0) {
    const charIdsBeingDeleted = new Set(chars.map((c) => c.id));
    const allChars = await db.characters.toArray();
    const stillReferenced = new Set<string>();
    for (const c of allChars) {
      if (!c.imageId) continue;
      if (charIdsBeingDeleted.has(c.id)) continue;
      if (candidateImageIds.has(c.imageId)) stillReferenced.add(c.imageId);
    }
    imageIdsToDelete = [...candidateImageIds].filter((imgId) => !stillReferenced.has(imgId));
  }

  await db.transaction(
    'rw',
    [db.tierLists, db.characters, db.relationships, db.evidence, db.images],
    async () => {
      if (imageIdsToDelete.length > 0) await db.images.bulkDelete(imageIdsToDelete);
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
  await db.tierLists.update(getActiveTierListId(), {
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
  const t0 = performance.now();
  const id = getActiveTierListId();
  const [relationships, tierList, characters] = await Promise.all([
    db.relationships.where('tierListId').equals(id).toArray(),
    ensureTierList(),
    db.characters.where('tierListId').equals(id).toArray(),
  ]);

  const tierDefs = tierList.tierDefs ?? DEFAULT_TIER_DEFS;
  const tierIds = tierDefs.map((t) => t.id);
  const allCharIds = new Set(characters.map((c) => c.id));
  const tEnforce = performance.now();
  const newAssignments = autoPlaceAndEnforce(tierList.tiers, relationships, allCharIds, tierIds);
  const enforceMs = performance.now() - tEnforce;

  if (
    newAssignments.length !== tierList.tiers.length ||
    newAssignments.some((a, i) => {
      const orig = tierList.tiers[i];
      return !orig || orig.characterId !== a.characterId || orig.tier !== a.tier || orig.position !== a.position;
    })
  ) {
    undoManager.push(tierList.tiers, 'relationship');
    await updateTierAssignments(newAssignments);
  }
  const totalMs = performance.now() - t0;
  if (totalMs > 200) {
    console.info(
      `[enforce] enforceAndAutoPlace took ${Math.round(totalMs)}ms (autoPlaceAndEnforce=${Math.round(enforceMs)}ms, ${relationships.length} rels, ${characters.length} chars)`,
    );
  }
}

// ── Tier definition management ──

export async function addTierDef(name: string, color: string): Promise<void> {
  const tierList = await ensureTierList();
  const tierDefs = [...(tierList.tierDefs ?? DEFAULT_TIER_DEFS)];
  const id = crypto.randomUUID();
  tierDefs.push({ id, name, color });
  await db.tierLists.update(getActiveTierListId(), { tierDefs, updatedAt: Date.now() });
}

export async function removeTierDef(tierId: string): Promise<void> {
  const tierList = await ensureTierList();
  const tierDefs = (tierList.tierDefs ?? DEFAULT_TIER_DEFS).filter((t) => t.id !== tierId);
  // Also remove any assignments in that tier
  const tiers = tierList.tiers.filter((a) => a.tier !== tierId);
  await db.tierLists.update(getActiveTierListId(), { tierDefs, tiers, updatedAt: Date.now() });
}

export async function renameTierDef(tierId: string, name: string): Promise<void> {
  const tierList = await ensureTierList();
  const tierDefs = (tierList.tierDefs ?? DEFAULT_TIER_DEFS).map((t) =>
    t.id === tierId ? { ...t, name } : t,
  );
  await db.tierLists.update(getActiveTierListId(), { tierDefs, updatedAt: Date.now() });
}

export async function recolorTierDef(tierId: string, color: string): Promise<void> {
  const tierList = await ensureTierList();
  const tierDefs = (tierList.tierDefs ?? DEFAULT_TIER_DEFS).map((t) =>
    t.id === tierId ? { ...t, color } : t,
  );
  await db.tierLists.update(getActiveTierListId(), { tierDefs, updatedAt: Date.now() });
}

export async function reorderTierDefs(tierIds: string[]): Promise<void> {
  const tierList = await ensureTierList();
  const defsMap = new Map((tierList.tierDefs ?? DEFAULT_TIER_DEFS).map((t) => [t.id, t]));
  const tierDefs = tierIds.map((id) => defsMap.get(id)!).filter(Boolean);
  await db.tierLists.update(getActiveTierListId(), { tierDefs, updatedAt: Date.now() });
}
