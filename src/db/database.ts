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

export { db };
