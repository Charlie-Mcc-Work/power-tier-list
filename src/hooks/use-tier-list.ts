import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { TierList, TierListMode, TierAssignment, Character } from '../types';
import { DEFAULT_TIER_DEFS } from '../types';
import { autoPlaceAndEnforce, compactUpward } from '../lib/enforce-constraints';
import { undoManager } from '../lib/undo';
import { log } from '../lib/logger';
import { invalidateImage } from './use-image';
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

export async function createTierList(name: string, mode: TierListMode = 'graph'): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.tierLists.add({
    id,
    name,
    mode,
    tierDefs: DEFAULT_TIER_DEFS,
    tiers: [],
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/**
 * Duplicate a tier list into a new SIMPLE list: same tier defs, characters,
 * and placements, but no relationships and no enforcement. Characters get
 * fresh ids (so the copy is independently editable/deletable) while sharing
 * the source's image blobs — deleteCharacters/deleteTierList already check
 * cross-list references before removing an image, so sharing is safe and
 * avoids duplicating megabytes of blobs.
 */
export async function duplicateAsSimpleList(sourceId: string): Promise<string> {
  const source = await db.tierLists.get(sourceId);
  if (!source) throw new Error('Tier list not found');
  const sourceChars = await db.characters.where('tierListId').equals(sourceId).toArray();

  const newListId = crypto.randomUUID();
  const now = Date.now();
  const charIdMap = new Map<string, string>();
  for (const c of sourceChars) charIdMap.set(c.id, crypto.randomUUID());

  const newChars: Character[] = sourceChars.map((c) => ({
    ...c,
    id: charIdMap.get(c.id)!,
    tierListId: newListId,
    createdAt: now,
    updatedAt: now,
  }));
  const newList: TierList = {
    id: newListId,
    name: `${source.name} (simple)`,
    mode: 'simple',
    tierDefs: (source.tierDefs ?? DEFAULT_TIER_DEFS).map((t) => ({ ...t })),
    // Drop assignments whose character no longer exists rather than copying
    // dangling ids into the new list.
    tiers: source.tiers
      .filter((t) => charIdMap.has(t.characterId))
      .map((t) => ({ ...t, characterId: charIdMap.get(t.characterId)! })),
    createdAt: now,
    updatedAt: now,
  };

  await db.transaction('rw', [db.tierLists, db.characters], async () => {
    await db.tierLists.add(newList);
    if (newChars.length > 0) await db.characters.bulkAdd(newChars);
  });

  return newListId;
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
    [db.tierLists, db.characters, db.relationships, db.images],
    async () => {
      if (imageIdsToDelete.length > 0) await db.images.bulkDelete(imageIdsToDelete);
      await db.characters.where('tierListId').equals(id).delete();
      await db.relationships.where('tierListId').equals(id).delete();
      await db.tierLists.delete(id);
    },
  );

  // Release cached object URLs (and their blobs) for the deleted images —
  // mirrors deleteCharacters. Without it a later import restoring the same
  // ids would serve stale cached URLs.
  for (const imgId of imageIdsToDelete) invalidateImage(imgId);
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
    log.warn(
      'enforce',
      `enforceAndAutoPlace took ${Math.round(totalMs)}ms (autoPlaceAndEnforce=${Math.round(enforceMs)}ms, ${relationships.length} rels, ${characters.length} chars)`,
    );
  }
}

/**
 * Move every placed character up as far as their relationships allow.
 * Unranked characters are untouched. Returns the number moved, or an
 * error if any chain is longer than the tier list.
 */
export async function compactTierList(): Promise<
  { ok: true; moved: number; reordered: number } | { ok: false; reason: string }
> {
  const id = getActiveTierListId();
  const [relationships, tierList, characters] = await Promise.all([
    db.relationships.where('tierListId').equals(id).toArray(),
    ensureTierList(),
    db.characters.where('tierListId').equals(id).toArray(),
  ]);

  const tierDefs = tierList.tierDefs ?? DEFAULT_TIER_DEFS;
  const tierIds = tierDefs.map((t) => t.id);
  const charNames = new Map(characters.map((c) => [c.id, c.name]));

  const result = compactUpward(tierList.tiers, relationships, tierIds, charNames);
  if (!result.ok) return { ok: false, reason: result.reason };

  const origByChar = new Map(tierList.tiers.map((a) => [a.characterId, a]));
  let reordered = 0;
  for (const a of result.assignments) {
    const orig = origByChar.get(a.characterId);
    if (orig && orig.tier === a.tier && orig.position !== a.position) reordered++;
  }

  if (result.movedCount === 0 && reordered === 0) {
    return { ok: true, moved: 0, reordered: 0 };
  }

  undoManager.push(tierList.tiers, 'drag');
  await updateTierAssignments(result.assignments);
  return { ok: true, moved: result.movedCount, reordered };
}

// ── Tier definition management ──

/**
 * Insert a new tier at a specific index. Existing tiers at and after the
 * index shift down. Index is clamped to [0, tierDefs.length].
 */
export async function insertTierDefAt(
  index: number,
  name: string,
  color: string,
): Promise<string> {
  const tierList = await ensureTierList();
  const tierDefs = [...(tierList.tierDefs ?? DEFAULT_TIER_DEFS)];
  const id = crypto.randomUUID();
  const clamped = Math.max(0, Math.min(index, tierDefs.length));
  tierDefs.splice(clamped, 0, { id, name, color });
  await db.tierLists.update(getActiveTierListId(), { tierDefs, updatedAt: Date.now() });
  return id;
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
