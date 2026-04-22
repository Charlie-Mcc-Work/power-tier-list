import { db as localDb } from '../db/database';
import { log } from './logger';

const STORAGE_KEY_URL = 'ptl_sync_url';
const STORAGE_KEY_TOKEN = 'ptl_sync_token';

export function getSyncConfig(): { url: string; token: string } | null {
  const url = localStorage.getItem(STORAGE_KEY_URL);
  if (!url) return null;
  // Token is optional — server may run in open mode on a private network.
  const token = localStorage.getItem(STORAGE_KEY_TOKEN) ?? '';
  return { url, token };
}

export function setSyncConfig(url: string, token: string) {
  localStorage.setItem(STORAGE_KEY_URL, url.replace(/\/$/, ''));
  if (token) {
    localStorage.setItem(STORAGE_KEY_TOKEN, token);
  } else {
    localStorage.removeItem(STORAGE_KEY_TOKEN);
  }
}

/** Probe server auth requirement. Returns null if unreachable. */
export async function probeServer(url: string): Promise<{ requiresAuth: boolean } | null> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/health`);
    if (!res.ok) return null;
    const j = await res.json();
    return { requiresAuth: Boolean(j?.requiresAuth) };
  } catch {
    return null;
  }
}

export function clearSyncConfig() {
  localStorage.removeItem(STORAGE_KEY_URL);
  localStorage.removeItem(STORAGE_KEY_TOKEN);
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const config = getSyncConfig();
  if (!config) throw new Error('Sync not configured');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (config.token) headers['Authorization'] = `Bearer ${config.token}`;

  const res = await fetch(`${config.url}${path}`, { ...options, headers });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Sync error ${res.status}: ${text}`);
  }

  return res.json();
}

/** Push all local tier lists to the server */
export async function syncPush(): Promise<{ pushed: number }> {
  const tierLists = await localDb.tierLists.toArray();
  let pushed = 0;

  for (const tl of tierLists) {
    // Export data scoped to this tier list
    const characters = await localDb.characters.where('tierListId').equals(tl.id).toArray();
    const relationships = await localDb.relationships.where('tierListId').equals(tl.id).toArray();
    const evidence = await localDb.evidence.where('tierListId').equals(tl.id).toArray();

    // Get images for these characters
    const imageIds = characters.map((c) => c.imageId).filter((id): id is string => !!id);
    const images = await localDb.images.bulkGet(imageIds);
    const serializedImages = await Promise.all(
      images.filter(Boolean).map(async (img) => {
        if (!img) return null;
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(img.blob);
        });
        return { id: img.id, mimeType: img.mimeType, originalFilename: img.originalFilename, createdAt: img.createdAt, dataUrl };
      }),
    );

    const data = {
      tierList: tl,
      characters,
      relationships,
      evidence,
      images: serializedImages.filter(Boolean),
    };

    await apiFetch(`/api/lists/${tl.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: tl.name, data: JSON.stringify(data) }),
    });
    pushed++;
    log.info('sync', `pushed: ${tl.name}`);
  }

  return { pushed };
}

/** Pull all tier lists from the server and merge */
export async function syncPull(): Promise<{ pulled: number }> {
  const remoteLists: Array<{ id: string; name: string; updated_at: number }> = await apiFetch('/api/lists');
  let pulled = 0;

  for (const remote of remoteLists) {
    const local = await localDb.tierLists.get(remote.id);
    // Pull if remote is newer or doesn't exist locally
    if (!local || remote.updated_at > local.updatedAt) {
      const full = await apiFetch(`/api/lists/${remote.id}`);
      const data = JSON.parse(full.data);

      await localDb.transaction('rw', [localDb.tierLists, localDb.characters, localDb.relationships, localDb.evidence, localDb.images], async () => {
        // Clear existing data for this list
        await localDb.characters.where('tierListId').equals(remote.id).delete();
        await localDb.relationships.where('tierListId').equals(remote.id).delete();
        await localDb.evidence.where('tierListId').equals(remote.id).delete();

        // Import
        await localDb.tierLists.put(data.tierList);
        if (data.characters?.length) await localDb.characters.bulkPut(data.characters);
        if (data.relationships?.length) await localDb.relationships.bulkPut(data.relationships);
        if (data.evidence?.length) await localDb.evidence.bulkPut(data.evidence);

        // Import images
        if (data.images) {
          for (const img of data.images) {
            if (!img) continue;
            const existing = await localDb.images.get(img.id);
            if (existing) continue; // don't re-import existing images
            const [header, base64] = img.dataUrl.split(',');
            const mimeMatch = header.match(/:(.*?);/);
            const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
            const bytes = atob(base64);
            const arr = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
            await localDb.images.put({
              id: img.id,
              blob: new Blob([arr], { type: mime }),
              mimeType: img.mimeType,
              originalFilename: img.originalFilename,
              createdAt: img.createdAt,
            });
          }
        }
      });

      pulled++;
      log.info('sync', `pulled: ${remote.name}`);
    }
  }

  return { pulled };
}

/** Create a share link for a tier list */
export async function createShareLink(tierListId: string): Promise<string> {
  const tl = await localDb.tierLists.get(tierListId);
  if (!tl) throw new Error('Tier list not found');

  const characters = await localDb.characters.where('tierListId').equals(tierListId).toArray();
  const relationships = await localDb.relationships.where('tierListId').equals(tierListId).toArray();

  // Share without images (too large) — just names and structure
  const data = { tierList: tl, characters, relationships };

  const result = await apiFetch('/api/share', {
    method: 'POST',
    body: JSON.stringify({ name: tl.name, data: JSON.stringify(data) }),
  });

  const config = getSyncConfig()!;
  return `${config.url}/api/shared/${result.code}`;
}

/** Check if sync server is reachable */
export async function checkConnection(): Promise<boolean> {
  try {
    await apiFetch('/api/health');
    return true;
  } catch {
    return false;
  }
}
