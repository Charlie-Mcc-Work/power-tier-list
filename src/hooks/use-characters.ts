import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { Character } from '../types';
import { getActiveTierListId } from './use-tier-list';
import { useUIStore } from '../stores/ui-store';

export function useCharacters(): Character[] {
  // Subscribe to the store directly so we re-render when the user switches
  // tier lists. Reading getActiveTierListId() during render is NOT reactive.
  const tierListId = useUIStore((s) => s.activeTierListId) ?? 'default';
  return useLiveQuery(
    () => db.characters.where('tierListId').equals(tierListId).toArray(),
    [tierListId],
  ) ?? [];
}

export function useCharacter(id: string | null): Character | undefined {
  return useLiveQuery(
    () => (id ? db.characters.get(id) : undefined),
    [id],
  );
}

export async function addCharacter(name: string, imageFile?: File): Promise<string> {
  const id = crypto.randomUUID();
  const tierListId = getActiveTierListId();
  const now = Date.now();

  let imageId: string | undefined;
  if (imageFile) {
    imageId = crypto.randomUUID();
    await db.images.add({
      id: imageId,
      blob: imageFile,
      mimeType: imageFile.type,
      originalFilename: imageFile.name,
      createdAt: now,
    });
  }

  await db.characters.add({
    id,
    tierListId,
    name,
    imageId,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function addBulkCharactersByName(
  names: string[],
): Promise<{ added: number; skipped: number }> {
  const tierListId = getActiveTierListId();
  const existing = await db.characters.where('tierListId').equals(tierListId).toArray();
  const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));

  const now = Date.now();
  const toAdd: Character[] = [];
  let skipped = 0;

  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (existingNames.has(trimmed.toLowerCase())) {
      skipped++;
      continue;
    }
    existingNames.add(trimmed.toLowerCase());
    toAdd.push({
      id: crypto.randomUUID(),
      tierListId,
      name: trimmed,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (toAdd.length > 0) {
    await db.characters.bulkAdd(toAdd);
  }

  return { added: toAdd.length, skipped };
}

export async function setCharacterImage(characterId: string, imageFile: File): Promise<void> {
  const character = await db.characters.get(characterId);
  if (!character) return;

  const imageId = crypto.randomUUID();
  await db.images.add({
    id: imageId,
    blob: imageFile,
    mimeType: imageFile.type,
    originalFilename: imageFile.name,
    createdAt: Date.now(),
  });

  if (character.imageId) {
    await db.images.delete(character.imageId).catch(() => {});
  }

  await db.characters.update(characterId, { imageId, updatedAt: Date.now() });
}

export async function updateCharacterName(id: string, name: string): Promise<void> {
  await db.characters.update(id, { name, updatedAt: Date.now() });
}

export async function deleteCharacter(id: string): Promise<void> {
  await deleteCharacters([id]);
}

/**
 * Delete many characters in a single transaction. Removes their image blobs,
 * associated relationships, strips them out of evidence + tier assignments,
 * and leaves the DB consistent. Much faster than calling deleteCharacter
 * in a loop when the user selects dozens to remove at once.
 */
export async function deleteCharacters(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const idSet = new Set(ids);

  const characters = await db.characters.bulkGet(ids);
  const real = characters.filter((c): c is Character => !!c);
  if (real.length === 0) return 0;

  const tierListIds = new Set(real.map((c) => c.tierListId));
  const candidateImageIds = new Set(
    real.map((c) => c.imageId).filter((i): i is string => !!i),
  );

  // Figure out which images to safely delete: only those NOT referenced by
  // any character that isn't being deleted. Without this check, deleting a
  // list whose characters happened to share image ids with characters in
  // other lists would wipe the images out from under those siblings (the
  // bug behind the "all question marks" story).
  let imageIdsToDelete: string[] = [];
  if (candidateImageIds.size > 0) {
    const allChars = await db.characters.toArray();
    const stillReferenced = new Set<string>();
    for (const c of allChars) {
      if (!c.imageId) continue;
      if (idSet.has(c.id)) continue; // this character is being deleted
      if (candidateImageIds.has(c.imageId)) stillReferenced.add(c.imageId);
    }
    imageIdsToDelete = [...candidateImageIds].filter((id) => !stillReferenced.has(id));
  }

  await db.transaction(
    'rw',
    [db.characters, db.images, db.relationships, db.evidence, db.tierLists],
    async () => {
      if (imageIdsToDelete.length > 0) await db.images.bulkDelete(imageIdsToDelete);
      await db.characters.bulkDelete(real.map((c) => c.id));

      // Relationships: delete any edge touching a deleted character.
      const rels = await db.relationships.toArray();
      const relsToDelete = rels
        .filter((r) => idSet.has(r.superiorId) || idSet.has(r.inferiorId))
        .map((r) => r.id);
      if (relsToDelete.length > 0) await db.relationships.bulkDelete(relsToDelete);

      // Evidence: strip deleted character ids from each evidence row's refs.
      const evidence = await db.evidence.toArray();
      for (const ev of evidence) {
        const filtered = ev.characterIds.filter((cid) => !idSet.has(cid));
        if (filtered.length !== ev.characterIds.length) {
          await db.evidence.update(ev.id, { characterIds: filtered });
        }
      }

      // Tier lists: strip deleted character ids from tier assignments.
      for (const tlId of tierListIds) {
        const tl = await db.tierLists.get(tlId);
        if (!tl) continue;
        const filtered = tl.tiers.filter((t) => !idSet.has(t.characterId));
        if (filtered.length !== tl.tiers.length) {
          await db.tierLists.update(tlId, { tiers: filtered, updatedAt: Date.now() });
        }
      }
    },
  );

  return real.length;
}
