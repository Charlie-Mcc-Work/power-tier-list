import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { Character } from '../types';

export function useCharacters(): Character[] {
  return useLiveQuery(() => db.characters.toArray(), []) ?? [];
}

export function useCharacter(id: string | null): Character | undefined {
  return useLiveQuery(
    () => (id ? db.characters.get(id) : undefined),
    [id],
  );
}

export async function addCharacter(name: string, imageFile?: File): Promise<string> {
  const id = crypto.randomUUID();
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
  const existing = await db.characters.toArray();
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

  // Delete old image if it exists
  if (character.imageId) {
    await db.images.delete(character.imageId).catch(() => {});
  }

  await db.characters.update(characterId, { imageId, updatedAt: Date.now() });
}

export async function updateCharacterName(id: string, name: string): Promise<void> {
  await db.characters.update(id, { name, updatedAt: Date.now() });
}

export async function deleteCharacter(id: string): Promise<void> {
  const character = await db.characters.get(id);
  if (!character) return;

  await db.transaction('rw', [db.characters, db.images, db.relationships, db.evidence], async () => {
    if (character.imageId) await db.images.delete(character.imageId);
    await db.characters.delete(id);

    // Remove relationships involving this character
    const rels = await db.relationships
      .where('superiorId').equals(id)
      .or('inferiorId').equals(id)
      .toArray();
    await db.relationships.bulkDelete(rels.map((r) => r.id));

    // Remove character from evidence characterIds
    const evidence = await db.evidence.where('characterIds').equals(id).toArray();
    for (const ev of evidence) {
      await db.evidence.update(ev.id, {
        characterIds: ev.characterIds.filter((cid) => cid !== id),
      });
    }

    // Remove from tier lists
    const tierLists = await db.tierLists.toArray();
    for (const tl of tierLists) {
      const filtered = tl.tiers.filter((t) => t.characterId !== id);
      if (filtered.length !== tl.tiers.length) {
        await db.tierLists.update(tl.id, { tiers: filtered, updatedAt: Date.now() });
      }
    }
  });
}
