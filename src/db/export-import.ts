import { db } from './database';
import type { Snapshot } from './database';
import type { Character, TierList, Relationship, Evidence, ImageBlob } from '../types';

interface ExportData {
  version: 1;
  exportedAt: number;
  characters: Character[];
  tierLists: TierList[];
  relationships: Relationship[];
  evidence: Evidence[];
  images: Array<Omit<ImageBlob, 'blob'> & { dataUrl: string }>;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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

export async function exportData(): Promise<string> {
  const [characters, tierLists, relationships, evidence, images] = await Promise.all([
    db.characters.toArray(),
    db.tierLists.toArray(),
    db.relationships.toArray(),
    db.evidence.toArray(),
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
    evidence,
    images: serializedImages,
  };

  return JSON.stringify(data);
}

export async function importData(json: string): Promise<void> {
  // Auto-snapshot before import so user can recover
  await createSnapshot('Before import');

  const data: ExportData = JSON.parse(json);

  if (data.version !== 1) {
    throw new Error(`Unsupported export version: ${data.version}`);
  }

  await db.transaction(
    'rw',
    [db.characters, db.tierLists, db.relationships, db.evidence, db.images],
    async () => {
      await Promise.all([
        db.characters.clear(),
        db.tierLists.clear(),
        db.relationships.clear(),
        db.evidence.clear(),
        db.images.clear(),
      ]);

      const images: ImageBlob[] = data.images.map((img) => ({
        id: img.id,
        blob: dataUrlToBlob(img.dataUrl),
        mimeType: img.mimeType,
        originalFilename: img.originalFilename,
        createdAt: img.createdAt,
      }));

      await Promise.all([
        db.characters.bulkAdd(data.characters),
        db.tierLists.bulkAdd(data.tierLists),
        db.relationships.bulkAdd(data.relationships),
        db.evidence.bulkAdd(data.evidence),
        db.images.bulkAdd(images),
      ]);
    },
  );
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

// ── Snapshot system ──

const MAX_SNAPSHOTS = 20;

export async function createSnapshot(name: string): Promise<string> {
  const json = await exportData();
  const id = crypto.randomUUID();
  await db.snapshots.add({
    id,
    name,
    createdAt: Date.now(),
    data: json,
  });

  // Prune old snapshots beyond the limit
  const all = await db.snapshots.orderBy('createdAt').toArray();
  if (all.length > MAX_SNAPSHOTS) {
    const toDelete = all.slice(0, all.length - MAX_SNAPSHOTS);
    await db.snapshots.bulkDelete(toDelete.map((s) => s.id));
  }

  return id;
}

export async function restoreSnapshot(id: string): Promise<void> {
  const snapshot = await db.snapshots.get(id);
  if (!snapshot) throw new Error('Snapshot not found');

  // Save current state before restoring so the restore itself is recoverable
  await createSnapshot('Before restore');
  await importDataWithoutSnapshot(snapshot.data);
}

/** Import without creating a snapshot (used internally by restoreSnapshot) */
async function importDataWithoutSnapshot(json: string): Promise<void> {
  const data: ExportData = JSON.parse(json);

  await db.transaction(
    'rw',
    [db.characters, db.tierLists, db.relationships, db.evidence, db.images],
    async () => {
      await Promise.all([
        db.characters.clear(),
        db.tierLists.clear(),
        db.relationships.clear(),
        db.evidence.clear(),
        db.images.clear(),
      ]);

      const images: ImageBlob[] = data.images.map((img) => ({
        id: img.id,
        blob: dataUrlToBlob(img.dataUrl),
        mimeType: img.mimeType,
        originalFilename: img.originalFilename,
        createdAt: img.createdAt,
      }));

      await Promise.all([
        db.characters.bulkAdd(data.characters),
        db.tierLists.bulkAdd(data.tierLists),
        db.relationships.bulkAdd(data.relationships),
        db.evidence.bulkAdd(data.evidence),
        db.images.bulkAdd(images),
      ]);
    },
  );
}

export async function listSnapshots(): Promise<Omit<Snapshot, 'data'>[]> {
  const all = await db.snapshots.orderBy('createdAt').reverse().toArray();
  return all.map(({ id, name, createdAt }) => ({ id, name, createdAt }));
}

export async function deleteSnapshot(id: string): Promise<void> {
  await db.snapshots.delete(id);
}

/**
 * Auto-snapshot on app start. Called once per session.
 * Only creates a snapshot if there's actual data to save.
 */
export async function autoSnapshotOnStart(): Promise<void> {
  const charCount = await db.characters.count();
  const tierListCount = await db.tierLists.count();
  if (charCount === 0 && tierListCount === 0) return; // nothing to snapshot

  const now = new Date();
  const label = `Auto ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  await createSnapshot(label);
}
