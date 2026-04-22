import { db as localDb } from '../db/database';
import { log } from './logger';

const STORAGE_KEY_URL = 'ptl_sync_url';
const STORAGE_KEY_TOKEN = 'ptl_sync_token';

/** Observable sync status for the nav-bar indicator. */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'disabled';
let currentStatus: SyncStatus = 'disabled';
const statusListeners = new Set<(s: SyncStatus) => void>();
function setStatus(s: SyncStatus) {
  if (s === currentStatus) return;
  currentStatus = s;
  statusListeners.forEach((l) => l(s));
}
export function getSyncStatus(): SyncStatus {
  return currentStatus;
}
export function subscribeSyncStatus(listener: (s: SyncStatus) => void): () => void {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => statusListeners.delete(listener);
}

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

/** Push local tier lists to the server. When `listIds` is given, only those
 *  are uploaded — enables auto-sync to upload only the list that changed. */
export async function syncPush(listIds?: string[]): Promise<{ pushed: number }> {
  const allLists = await localDb.tierLists.toArray();
  const tierLists = listIds ? allLists.filter((tl) => listIds.includes(tl.id)) : allLists;
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

// ── Auto-sync ──────────────────────────────────────────────────────────────
// On app load: pull once, then hook every write to tier-list-scoped tables
// and push the dirty lists after a short debounce. Pull again when the window
// regains focus after being hidden for a while (covers "edited on another
// device, switched back here").
//
// Last-writer-wins on conflicts — acceptable for single-user multi-device.

const PUSH_DEBOUNCE_MS = 2000;
const REFOCUS_PULL_THRESHOLD_MS = 5000;

let initialized = false;
let muted = false;
let pushTimer: number | null = null;
let dirtyIds = new Set<string>();
let lastBlurAt = 0;

function getListIdFrom(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  if (typeof o.tierListId === 'string') return o.tierListId;
  // A tierLists row itself: the primary key IS the list id.
  if (typeof o.id === 'string' && 'tierDefs' in o) return o.id as string;
  return undefined;
}

function markDirty(listId?: string) {
  if (muted) return;
  if (!getSyncConfig()) return;
  if (!listId) return;
  dirtyIds.add(listId);
  setStatus('syncing');
  if (pushTimer) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(flushPush, PUSH_DEBOUNCE_MS);
}

async function flushPush() {
  pushTimer = null;
  if (!getSyncConfig()) return;
  if (dirtyIds.size === 0) {
    setStatus('synced');
    return;
  }
  const ids = [...dirtyIds];
  dirtyIds = new Set();
  setStatus('syncing');
  try {
    await syncPush(ids);
    setStatus(dirtyIds.size === 0 ? 'synced' : 'syncing');
    log.info('sync', `auto-pushed ${ids.length} list(s)`);
  } catch (err) {
    // Restore dirtiness so the next edit (or manual retry) catches up.
    ids.forEach((id) => dirtyIds.add(id));
    setStatus('offline');
    log.warn('sync', `auto-push failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function pullSilently() {
  if (!getSyncConfig()) return;
  setStatus('syncing');
  muted = true;
  try {
    await syncPull();
    setStatus(dirtyIds.size === 0 ? 'synced' : 'syncing');
  } catch (err) {
    setStatus('offline');
    log.warn('sync', `auto-pull failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    muted = false;
  }
}

/** Wire up Dexie table hooks and focus listeners. Safe to call many times. */
export function initAutoSync() {
  if (initialized) return;
  initialized = true;

  // Register creating / updating / deleting hooks on each tier-list-scoped
  // table. Types differ per table so we can't loop — do it inline.
  localDb.tierLists.hook('creating', (_pk, obj) => { markDirty(getListIdFrom(obj)); });
  localDb.tierLists.hook('updating', (_mods, _pk, obj) => { markDirty(getListIdFrom(obj)); });
  localDb.tierLists.hook('deleting', (_pk, obj) => { markDirty(getListIdFrom(obj)); });

  localDb.characters.hook('creating', (_pk, obj) => { markDirty(getListIdFrom(obj)); });
  localDb.characters.hook('updating', (_mods, _pk, obj) => { markDirty(getListIdFrom(obj)); });
  localDb.characters.hook('deleting', (_pk, obj) => { markDirty(getListIdFrom(obj)); });

  localDb.relationships.hook('creating', (_pk, obj) => { markDirty(getListIdFrom(obj)); });
  localDb.relationships.hook('updating', (_mods, _pk, obj) => { markDirty(getListIdFrom(obj)); });
  localDb.relationships.hook('deleting', (_pk, obj) => { markDirty(getListIdFrom(obj)); });

  localDb.evidence.hook('creating', (_pk, obj) => { markDirty(getListIdFrom(obj)); });
  localDb.evidence.hook('updating', (_mods, _pk, obj) => { markDirty(getListIdFrom(obj)); });
  localDb.evidence.hook('deleting', (_pk, obj) => { markDirty(getListIdFrom(obj)); });

  window.addEventListener('blur', () => { lastBlurAt = Date.now(); });
  window.addEventListener('focus', () => {
    if (Date.now() - lastBlurAt > REFOCUS_PULL_THRESHOLD_MS) {
      pullSilently();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastBlurAt > REFOCUS_PULL_THRESHOLD_MS) {
      pullSilently();
    }
    if (document.visibilityState === 'hidden') {
      lastBlurAt = Date.now();
    }
  });

  // Initial pull on app start, then mark status idle/offline.
  if (getSyncConfig()) {
    setStatus('syncing');
    pullSilently();
  } else {
    setStatus('disabled');
  }
}

/** Called by SyncPanel after the user sets/clears sync config — just updates
 *  the status indicator. SyncPanel triggers its own pull/push on connect. */
export function refreshAutoSync() {
  if (!getSyncConfig()) {
    setStatus('disabled');
    dirtyIds.clear();
    if (pushTimer) { window.clearTimeout(pushTimer); pushTimer = null; }
    return;
  }
  setStatus(dirtyIds.size === 0 ? 'synced' : 'syncing');
}
