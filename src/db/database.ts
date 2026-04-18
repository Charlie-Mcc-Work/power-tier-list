import Dexie, { type EntityTable } from 'dexie';
import type { Character, TierList, Relationship, Evidence, ImageBlob } from '../types';

const db = new Dexie('PowerTierListDB') as Dexie & {
  characters: EntityTable<Character, 'id'>;
  tierLists: EntityTable<TierList, 'id'>;
  relationships: EntityTable<Relationship, 'id'>;
  evidence: EntityTable<Evidence, 'id'>;
  images: EntityTable<ImageBlob, 'id'>;
};

db.version(1).stores({
  characters: 'id, name, createdAt',
  tierLists: 'id, name, createdAt',
  relationships: 'id, superiorId, inferiorId, [superiorId+inferiorId]',
  evidence: 'id, kind, *characterIds, *relationshipIds',
  images: 'id, originalFilename',
});

db.version(2).stores({
  characters: 'id, name, tierListId, createdAt',
  tierLists: 'id, name, createdAt',
  relationships: 'id, superiorId, inferiorId, tierListId, [superiorId+inferiorId]',
  evidence: 'id, kind, tierListId, *characterIds, *relationshipIds',
  images: 'id, originalFilename',
}).upgrade(async (tx) => {
  // Assign all existing records to the first tier list that exists
  const tierLists = await tx.table('tierLists').toArray();
  const defaultId = tierLists.length > 0 ? tierLists[0].id : 'default';

  await tx.table('characters').toCollection().modify((char) => {
    if (!char.tierListId) char.tierListId = defaultId;
  });
  await tx.table('relationships').toCollection().modify((rel) => {
    if (!rel.tierListId) rel.tierListId = defaultId;
  });
  await tx.table('evidence').toCollection().modify((ev) => {
    if (!ev.tierListId) ev.tierListId = defaultId;
  });
});

export { db };
