import { db } from './database';
import type { Snapshot } from './database';
import type { Character, TierList, Relationship, ImageBlob } from '../types';

interface ExportData {
  version: 1;
  /**
   * When true, the snapshot does NOT include image blobs. Used for
   * auto-snapshots (app start, debounced activity, before-restore) where
   * serializing every image to base64 would block the main thread and spike
   * RAM for large collections. Images live in their own table and are
   * preserved across restores of partial snapshots — the images table is
   * simply left untouched.
   */
  partial?: boolean;
  exportedAt: number;
  characters: Character[];
  tierLists: TierList[];
  relationships: Relationship[];
  /** Legacy field from pre-v6 exports. Ignored on import; never written. */
  evidence?: unknown[];
  images: Array<Omit<ImageBlob, 'blob'> & { dataUrl: string }>;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  // Cross-platform: FileReader isn't available in Node tests, so we use
  // Blob.arrayBuffer() (supported in modern browsers and Node 18+) and then
  // base64-encode in chunks. The chunking avoids a "too many arguments"
  // stack overflow on very large blobs.
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000; // 32 KB per slice
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  const base64 = btoa(binary);
  return `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * FULL export including image blobs (base64-encoded). Used for user-initiated
 * Export downloads, manual snapshots, and the file-system / cloud backup
 * paths — i.e. anything that needs to survive an IndexedDB wipe.
 *
 * Expensive for large collections: reads every image blob and base64-encodes
 * it on the main thread. Do NOT call from automatic/debounced code paths
 * without explicit opt-in.
 */
export async function exportData(): Promise<string> {
  const [characters, tierLists, relationships, images] = await Promise.all([
    db.characters.toArray(),
    db.tierLists.toArray(),
    db.relationships.toArray(),
    db.images.toArray(),
  ]);

  const serializedImages = await Promise.all(
    images.map(async (img) => ({
      id: img.id,
      mimeType: img.mimeType,
      originalFilename: img.originalFilename,
      createdAt: img.createdAt,
      dataUrl: await blobToDataUrl(img.blob),
    })),
  );

  const data: ExportData = {
    version: 1,
    exportedAt: Date.now(),
    characters,
    tierLists,
    relationships,
    images: serializedImages,
  };

  return JSON.stringify(data);
}

/**
 * CORE-ONLY export (no image blobs). Used by automatic snapshots — orders of
 * magnitude cheaper on large collections. Images are stable (once uploaded
 * they're never mutated) and restoring a partial snapshot preserves the
 * images table, so references stay valid.
 */
export async function exportCoreData(): Promise<string> {
  const [characters, tierLists, relationships] = await Promise.all([
    db.characters.toArray(),
    db.tierLists.toArray(),
    db.relationships.toArray(),
  ]);

  const data: ExportData = {
    version: 1,
    partial: true,
    exportedAt: Date.now(),
    characters,
    tierLists,
    relationships,
    images: [],
  };

  return JSON.stringify(data);
}

export interface ImportSummary {
  tierLists: number;
  characters: number;
  relationships: number;
  images: number;
}

export type ImportMode = 'merge' | 'replace';

export interface ImportOptions {
  /**
   * How to combine the file's contents with what's already in the DB.
   *   merge   — upsert each row (default). Nothing is deleted; items with
   *             matching ids are overwritten by the file's copy.
   *   replace — wipe the relevant tables first, then load from the file.
   *             Destructive; for disaster recovery only.
   */
  mode?: ImportMode;
}

/**
 * Drop the pre-v6 `evidenceIds` field from a relationship object. Used on
 * every import path so old files and snapshots keep loading cleanly without
 * polluting the live DB with the stale field.
 */
function stripLegacyEvidenceIds(rel: Relationship): Relationship {
  const copy = { ...(rel as Relationship & { evidenceIds?: unknown }) };
  delete copy.evidenceIds;
  return copy;
}

async function applyImportedData(data: ExportData, mode: ImportMode): Promise<void> {
  // Partial snapshots leave the images table alone (both in merge AND replace
  // mode — a partial file has no images to use as a replacement, so wiping
  // them would just break image refs).
  const includesImages = !data.partial && !!data.images && data.images.length > 0;
  const tables = includesImages
    ? [db.characters, db.tierLists, db.relationships, db.images]
    : [db.characters, db.tierLists, db.relationships];

  const imagesToWrite: ImageBlob[] = includesImages
    ? (data.images ?? []).map((img) => ({
        id: img.id,
        blob: dataUrlToBlob(img.dataUrl),
        mimeType: img.mimeType,
        originalFilename: img.originalFilename,
        createdAt: img.createdAt,
      }))
    : [];

  // Pre-v6 rels had an evidenceIds field we no longer use. Strip it on the way
  // in so old export files and old snapshots still load cleanly.
  const cleanedRels: Relationship[] = (data.relationships ?? []).map((r) => stripLegacyEvidenceIds(r));

  await db.transaction('rw', tables, async () => {
    if (mode === 'replace') {
      await Promise.all([
        db.characters.clear(),
        db.tierLists.clear(),
        db.relationships.clear(),
      ]);
      if (includesImages) await db.images.clear();
    }

    // bulkPut upserts by primary key: existing ids get overwritten, new ones
    // get inserted. For merge mode this is the whole story; for replace mode
    // the tables are already empty so this is equivalent to bulkAdd.
    const writes: Promise<unknown>[] = [
      db.characters.bulkPut(data.characters),
      db.tierLists.bulkPut(data.tierLists),
      db.relationships.bulkPut(cleanedRels),
    ];
    if (includesImages) {
      writes.push(db.images.bulkPut(imagesToWrite));
    }
    await Promise.all(writes);
  });
}

export async function importData(
  json: string,
  options: ImportOptions = {},
): Promise<ImportSummary> {
  const mode: ImportMode = options.mode ?? 'merge';

  // Auto-snapshot before import so the operation is reversible. Merge mode
  // only upserts (nothing is lost that wasn't also in the file), so a
  // core-only snapshot is enough. Replace mode clears images, so a full
  // snapshot is needed to fully recover.
  await createSnapshot(
    mode === 'replace' ? 'Before import (replace)' : 'Before import (merge)',
    { core: mode === 'merge' },
  );

  let data: ExportData;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (data.version !== 1) {
    throw new Error(`Unsupported export version: ${data.version}`);
  }
  if (!Array.isArray(data.tierLists) || !Array.isArray(data.characters)) {
    throw new Error('File does not look like a tier-list export (missing required fields)');
  }

  await applyImportedData(data, mode);

  return {
    tierLists: data.tierLists.length,
    characters: data.characters.length,
    relationships: (data.relationships ?? []).length,
    images: (data.images ?? []).length,
  };
}

export function downloadExport(json: string, filename = 'power-tier-list-export.json') {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Per-tier-list export / import ────────────────────────────────────
// A "single-list" file contains exactly one tier list plus the characters,
// relationships, and images referenced by it. Meant for sharing a list or
// backing up one list without touching the rest of the DB.

export interface SingleListExport {
  version: 2;
  kind: 'tierList';
  exportedAt: number;
  tierList: TierList;
  characters: Character[];
  relationships: Relationship[];
  /** Legacy field from pre-v6 files. Ignored on import; never written. */
  evidence?: unknown[];
  images: Array<Omit<ImageBlob, 'blob'> & { dataUrl: string }>;
}

export type ImportFileKind =
  | { kind: 'single-list'; data: SingleListExport }
  | { kind: 'full-db'; data: ExportData }
  | { kind: 'unknown'; error: string };

export function detectImportFileKind(json: string): ImportFileKind {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { kind: 'unknown', error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as { version?: unknown; kind?: unknown; tierList?: unknown; tierLists?: unknown };
    if (obj.version === 2 && obj.kind === 'tierList' && obj.tierList) {
      return { kind: 'single-list', data: parsed as SingleListExport };
    }
    if (obj.version === 1 && Array.isArray(obj.tierLists) && Array.isArray((obj as { characters?: unknown }).characters)) {
      return { kind: 'full-db', data: parsed as ExportData };
    }
  }
  return { kind: 'unknown', error: 'File does not look like a tier-list export' };
}

/**
 * Export a single tier list plus everything scoped to it:
 * characters (where tierListId matches), relationships (scoped),
 * evidence (scoped), and the images those characters reference.
 */
export async function exportSingleList(tierListId: string): Promise<string> {
  const tl = await db.tierLists.get(tierListId);
  if (!tl) throw new Error('Tier list not found');

  const [characters, relationships] = await Promise.all([
    db.characters.where('tierListId').equals(tierListId).toArray(),
    db.relationships.where('tierListId').equals(tierListId).toArray(),
  ]);

  const imageIds = Array.from(
    new Set(characters.map((c) => c.imageId).filter((id): id is string => !!id)),
  );
  const imageRows = await db.images.bulkGet(imageIds);
  const serializedImages = await Promise.all(
    imageRows
      .filter((img): img is ImageBlob => !!img)
      .map(async (img) => ({
        id: img.id,
        mimeType: img.mimeType,
        originalFilename: img.originalFilename,
        createdAt: img.createdAt,
        dataUrl: await blobToDataUrl(img.blob),
      })),
  );

  const data: SingleListExport = {
    version: 2,
    kind: 'tierList',
    exportedAt: Date.now(),
    tierList: tl,
    characters,
    relationships,
    images: serializedImages,
  };
  return JSON.stringify(data);
}

function validateSingleListShape(data: SingleListExport): void {
  if (data.version !== 2 || data.kind !== 'tierList') {
    throw new Error('Not a single-list export file');
  }
  if (!data.tierList || typeof data.tierList.id !== 'string') {
    throw new Error('Single-list file is missing its tierList');
  }
  if (!Array.isArray(data.characters)) {
    throw new Error('Single-list file is missing its characters array');
  }
}

/**
 * Write imported images under FRESH ids and return a map from each image's
 * file id → newly-assigned db id. Callers use this to rewrite
 * `character.imageId` references so the imported list is fully self-contained
 * and deleting it won't drag images away from other lists that happen to
 * reference the same original id.
 */
async function writeSingleListImagesWithFreshIds(
  images: Array<Omit<ImageBlob, 'blob'> & { dataUrl: string }>,
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();
  for (const img of images) {
    const newId = crypto.randomUUID();
    idMap.set(img.id, newId);
    await db.images.put({
      id: newId,
      blob: dataUrlToBlob(img.dataUrl),
      mimeType: img.mimeType,
      originalFilename: img.originalFilename,
      createdAt: img.createdAt,
    });
  }
  return idMap;
}

/**
 * Overwrite an existing tier list with the contents of a single-list file.
 * The TARGET tier list keeps its id; everything scoped to it is wiped and
 * refilled from the file. All other tier lists in the DB are untouched.
 *
 * Crucially: every imported character / relationship / evidence row gets a
 * FRESH uuid. If we reused the file's original ids, and those ids also
 * matched rows belonging to the source list (which they will, because the
 * file was exported from that list), Dexie's bulkPut would upsert and
 * silently move those characters away from the source. Fresh ids make the
 * import a true copy.
 */
export async function importSingleListReplace(
  targetTierListId: string,
  data: SingleListExport,
): Promise<ImportSummary> {
  validateSingleListShape(data);

  await createSnapshot('Before list import (replace current)', { core: true });

  // Build id remapping tables so we never collide with entities owned by
  // any other tier list in the user's DB.
  const charIdMap = new Map<string, string>();
  for (const c of data.characters) charIdMap.set(c.id, crypto.randomUUID());
  const relIdMap = new Map<string, string>();
  for (const r of data.relationships) relIdMap.set(r.id, crypto.randomUUID());

  // Write images FIRST under fresh ids so we know the mapping before we
  // remap character.imageId below. Done outside the big transaction because
  // image writes are independent and keep the transaction focused on
  // metadata.
  const imageIdMap = await writeSingleListImagesWithFreshIds(data.images);

  const now = Date.now();
  const newChars: Character[] = data.characters.map((c) => ({
    ...c,
    id: charIdMap.get(c.id)!,
    tierListId: targetTierListId,
    imageId: c.imageId ? (imageIdMap.get(c.imageId) ?? c.imageId) : undefined,
  }));
  const remappedTierList: TierList = {
    ...data.tierList,
    id: targetTierListId,
    tiers: data.tierList.tiers.map((t) => ({
      ...t,
      characterId: charIdMap.get(t.characterId) ?? t.characterId,
    })),
    updatedAt: now,
  };
  const newRels: Relationship[] = data.relationships.map((r) => ({
    ...stripLegacyEvidenceIds(r),
    id: relIdMap.get(r.id)!,
    tierListId: targetTierListId,
    superiorId: charIdMap.get(r.superiorId) ?? r.superiorId,
    inferiorId: charIdMap.get(r.inferiorId) ?? r.inferiorId,
  }));

  await db.transaction(
    'rw',
    [db.tierLists, db.characters, db.relationships],
    async () => {
      // Wipe only this list's scoped data, not anyone else's.
      await db.characters.where('tierListId').equals(targetTierListId).delete();
      await db.relationships.where('tierListId').equals(targetTierListId).delete();

      await db.tierLists.put(remappedTierList);
      if (newChars.length > 0) await db.characters.bulkAdd(newChars);
      if (newRels.length > 0) await db.relationships.bulkAdd(newRels);
    },
  );

  return {
    tierLists: 1,
    characters: newChars.length,
    relationships: newRels.length,
    images: data.images.length,
  };
}

/**
 * Add the file's tier list alongside existing lists. All entity ids are
 * freshly minted so no existing data is overwritten. Cross-references
 * within the file (tier assignments, relationships, evidence) are rewritten
 * to use the new ids.
 */
export async function importSingleListAsNew(
  data: SingleListExport,
): Promise<ImportSummary & { newTierListId: string }> {
  validateSingleListShape(data);

  await createSnapshot('Before list import (add new)', { core: true });

  const newTierListId = crypto.randomUUID();
  const charIdMap = new Map<string, string>();
  for (const c of data.characters) charIdMap.set(c.id, crypto.randomUUID());
  const relIdMap = new Map<string, string>();
  for (const r of data.relationships) relIdMap.set(r.id, crypto.randomUUID());

  // Fresh image copies so the new list is self-contained.
  const imageIdMap = await writeSingleListImagesWithFreshIds(data.images);

  const now = Date.now();
  const newChars: Character[] = data.characters.map((c) => ({
    ...c,
    id: charIdMap.get(c.id)!,
    tierListId: newTierListId,
    imageId: c.imageId ? (imageIdMap.get(c.imageId) ?? c.imageId) : undefined,
  }));
  const newTierList: TierList = {
    ...data.tierList,
    id: newTierListId,
    name: data.tierList.name,
    tiers: data.tierList.tiers.map((t) => ({
      ...t,
      characterId: charIdMap.get(t.characterId) ?? t.characterId,
    })),
    updatedAt: now,
  };
  const newRels: Relationship[] = data.relationships.map((r) => ({
    ...stripLegacyEvidenceIds(r),
    id: relIdMap.get(r.id)!,
    tierListId: newTierListId,
    superiorId: charIdMap.get(r.superiorId) ?? r.superiorId,
    inferiorId: charIdMap.get(r.inferiorId) ?? r.inferiorId,
  }));

  await db.transaction(
    'rw',
    [db.tierLists, db.characters, db.relationships],
    async () => {
      await db.tierLists.add(newTierList);
      if (newChars.length > 0) await db.characters.bulkAdd(newChars);
      if (newRels.length > 0) await db.relationships.bulkAdd(newRels);
    },
  );

  return {
    tierLists: 1,
    characters: newChars.length,
    relationships: newRels.length,
    images: data.images.length,
    newTierListId,
  };
}

// ── Snapshot system ──

const MAX_SNAPSHOTS = 20;

// Single-flight guard: overlapping timers shouldn't spawn concurrent snapshot
// work on the main thread.
let snapshotInFlight: Promise<string> | null = null;

export interface CreateSnapshotOptions {
  /** When true, skip image blobs — much faster and lower-RAM. Default false (full). */
  core?: boolean;
}

export async function createSnapshot(
  name: string,
  options: CreateSnapshotOptions = {},
): Promise<string> {
  if (snapshotInFlight) {
    return snapshotInFlight;
  }
  snapshotInFlight = (async () => {
    try {
      const json = options.core ? await exportCoreData() : await exportData();
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      await db.transaction('rw', [db.snapshots, db.snapshotData], async () => {
        await db.snapshots.add({ id, name, createdAt });
        await db.snapshotData.add({ id, data: json });
      });

      // Prune metadata + payload together so we don't leak orphaned data rows.
      const all = await db.snapshots.orderBy('createdAt').toArray();
      if (all.length > MAX_SNAPSHOTS) {
        const toDelete = all.slice(0, all.length - MAX_SNAPSHOTS).map((s) => s.id);
        await db.transaction('rw', [db.snapshots, db.snapshotData], async () => {
          await db.snapshots.bulkDelete(toDelete);
          await db.snapshotData.bulkDelete(toDelete);
        });
      }
      return id;
    } finally {
      snapshotInFlight = null;
    }
  })();
  return snapshotInFlight;
}

export async function restoreSnapshot(id: string): Promise<void> {
  const meta = await db.snapshots.get(id);
  if (!meta) throw new Error('Snapshot not found');
  const blob = await db.snapshotData.get(id);
  if (!blob) {
    throw new Error(
      "Snapshot payload is unavailable (the snapshot was created before a storage migration and its data was cleared). It can't be restored.",
    );
  }

  // "Before restore" snapshot so a bad restore is reversible. Core is fine —
  // restoring a partial snapshot never clears the images table.
  await createSnapshot('Before restore', { core: true });

  // Snapshot restore is a point-in-time rewind, so always replace-mode. For
  // core snapshots, applyImportedData automatically leaves the images table
  // alone regardless (there are no images in the file to use as replacement).
  const data: ExportData = JSON.parse(blob.data);
  await applyImportedData(data, 'replace');
}

/** Lightweight metadata-only list. Never loads the payload blobs. */
export async function listSnapshots(): Promise<Snapshot[]> {
  return db.snapshots.orderBy('createdAt').reverse().toArray();
}

export async function deleteSnapshot(id: string): Promise<void> {
  await db.transaction('rw', [db.snapshots, db.snapshotData], async () => {
    await db.snapshots.delete(id);
    await db.snapshotData.delete(id);
  });
}

/**
 * Escape hatch: wipe every in-browser snapshot + payload. Useful if a user's
 * snapshots table has grown to the point of eating memory. The user's live
 * data (tier lists, characters, relationships, images) is NOT touched — only
 * the recovery-point history is cleared.
 */
export async function clearAllSnapshots(): Promise<{ deleted: number }> {
  const count = await db.snapshots.count();
  await db.transaction('rw', [db.snapshots, db.snapshotData], async () => {
    await db.snapshots.clear();
    await db.snapshotData.clear();
  });
  return { deleted: count };
}

// No automatic snapshots. Snapshots are created only when the user clicks
// "Create Snapshot Now" in the Backups panel, or just before an Import via
// importData(). This keeps the main thread clear of surprise serialization
// work — a previous iteration used Dexie hooks + debounced timers and was
// the source of hard-to-pin-down freezes.
