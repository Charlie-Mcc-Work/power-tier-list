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

export async function addCharacter(name: string, imageFile: File): Promise<string> {
  const id = crypto.randomUUID();
  const imageId = crypto.randomUUID();
  const now = Date.now();

  await db.images.add({
    id: imageId,
    blob: imageFile,
    mimeType: imageFile.type,
    originalFilename: imageFile.name,
    createdAt: now,
  });

  await db.characters.add({
    id,
    name,
    imageId,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function updateCharacterName(id: string, name: string): Promise<void> {
  await db.characters.update(id, { name, updatedAt: Date.now() });
}

export async function deleteCharacter(id: string): Promise<void> {
  const character = await db.characters.get(id);
  if (!character) return;

  await db.transaction('rw', [db.characters, db.images, db.relationships, db.evidence], async () => {
    await db.images.delete(character.imageId);
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
