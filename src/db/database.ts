import Dexie, { type EntityTable } from 'dexie';
import type { Character, TierList, Relationship, ImageBlob } from '../types';

/**
 * Snapshot metadata. Kept separate from the payload blob so listing every
 * snapshot doesn't pull hundreds of MB into memory.
 */
export interface Snapshot {
  id: string;
  name: string;
  createdAt: number;
}

/** Snapshot payload, looked up by id on demand (restore, export-a-snapshot). */
export interface SnapshotData {
  id: string;
  data: string;
}

// Small key-value store for persistent app metadata (backup folder handle,
// last-backup timestamp, etc.). Dexie can structured-clone FileSystemHandles.
export interface MetaEntry {
  key: string;
  value: unknown;
}

const db = new Dexie('PowerTierListDB') as Dexie & {
  characters: EntityTable<Character, 'id'>;
  tierLists: EntityTable<TierList, 'id'>;
  relationships: EntityTable<Relationship, 'id'>;
  images: EntityTable<ImageBlob, 'id'>;
  snapshots: EntityTable<Snapshot, 'id'>;
  snapshotData: EntityTable<SnapshotData, 'id'>;
  meta: EntityTable<MetaEntry, 'key'>;
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

db.version(3).stores({
  characters: 'id, name, tierListId, createdAt',
  tierLists: 'id, name, createdAt',
  relationships: 'id, superiorId, inferiorId, tierListId, [superiorId+inferiorId]',
  evidence: 'id, kind, tierListId, *characterIds, *relationshipIds',
  images: 'id, originalFilename',
  snapshots: 'id, createdAt',
});

db.version(4).stores({
  characters: 'id, name, tierListId, createdAt',
  tierLists: 'id, name, createdAt',
  relationships: 'id, superiorId, inferiorId, tierListId, [superiorId+inferiorId]',
  evidence: 'id, kind, tierListId, *characterIds, *relationshipIds',
  images: 'id, originalFilename',
  snapshots: 'id, createdAt',
  meta: 'key',
});

// v5: split the snapshot payload into a separate `snapshotData` table.
// Pre-v5, the `snapshots` rows held the full JSON export (including every
// image base64-encoded) inline. Any `.toArray()` on that table pulled all
// payloads into JS heap — which on large collections translated to multiple
// GB of memory the moment the Backups panel opened. Separating metadata from
// payload means listing is cheap and payloads load only when a restore
// actually happens.
//
// Upgrade strategy: iterate snapshots one at a time, move the `data` string
// into `snapshotData`, strip it from `snapshots`. Legacy rows over a size
// cap are dropped (data only, metadata kept with a warning tag) — that
// bounds migration peak memory and clears out the biggest offenders.
db.version(5).stores({
  characters: 'id, name, tierListId, createdAt',
  tierLists: 'id, name, createdAt',
  relationships: 'id, superiorId, inferiorId, tierListId, [superiorId+inferiorId]',
  evidence: 'id, kind, tierListId, *characterIds, *relationshipIds',
  images: 'id, originalFilename',
  snapshots: 'id, createdAt',
  snapshotData: 'id',
  meta: 'key',
}).upgrade(async (tx) => {
  const snapshots = tx.table('snapshots');
  const snapshotData = tx.table('snapshotData');
  const LEGACY_MAX_CHARS = 10 * 1024 * 1024; // 10MB of UTF-16 ~= 20MB heap
  const ids = (await snapshots.toCollection().primaryKeys()) as string[];
  let migrated = 0;
  let dropped = 0;
  for (const id of ids) {
    const snap = (await snapshots.get(id)) as
      | { id: string; name: string; createdAt: number; data?: string }
      | undefined;
    if (!snap) continue;
    if (typeof snap.data !== 'string') continue;
    try {
      if (snap.data.length > LEGACY_MAX_CHARS) {
        // Too big to safely copy; drop payload but keep the metadata row so
        // the user sees the history and knows why it isn't restorable.
        await snapshots.update(snap.id, {
          data: undefined,
          name: `${snap.name} (payload dropped)`,
        });
        dropped++;
      } else {
        await snapshotData.put({ id: snap.id, data: snap.data });
        await snapshots.update(snap.id, { data: undefined });
        migrated++;
      }
    } catch (err) {
      console.warn('[db] snapshot migration failed for', snap.id, err);
      // Best-effort: strip the giant payload so the app isn't stuck.
      await snapshots.update(snap.id, { data: undefined });
      dropped++;
    }
  }
  if (migrated || dropped) {
    console.info(`[db] snapshot schema v5: migrated ${migrated}, dropped ${dropped}`);
  }
});

// v6: evidence feature removed. Drop the `evidence` store and strip the
// vestigial `evidenceIds` field from every relationship row so the schema
// reflects the current domain model. Per the cleanup request, any evidence
// records that happened to be in the user's DB are discarded outright — no
// export file claimed to carry real evidence, and the user confirmed there
// was nothing worth preserving.
db.version(6).stores({
  characters: 'id, name, tierListId, createdAt',
  tierLists: 'id, name, createdAt',
  relationships: 'id, superiorId, inferiorId, tierListId, [superiorId+inferiorId]',
  evidence: null,
  images: 'id, originalFilename',
  snapshots: 'id, createdAt',
  snapshotData: 'id',
  meta: 'key',
}).upgrade(async (tx) => {
  await tx.table('relationships').toCollection().modify((rel) => {
    delete (rel as { evidenceIds?: unknown }).evidenceIds;
  });
});

export { db };
