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
  imageStoreSupport = null;
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
  imageStoreSupport = null;
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

// ── Image store ────────────────────────────────────────────────────────────
// Newer servers store images separately from list data, keyed by image id
// (images are immutable per id — setCharacterImage mints a fresh id instead
// of mutating). A push asks the server which ids it's missing and uploads
// just those, one at a time, so list pushes carry no image payloads at all.
// The legacy format embedded every image in every list push as base64, which
// both re-uploaded the full image set on each edit and held several complete
// copies of it in memory per in-flight push.
//
// Older servers lack the endpoints; probe once per session and fall back to
// the embedded format for them.

let imageStoreSupport: boolean | null = null;

async function serverHasImageStore(): Promise<boolean> {
  if (imageStoreSupport !== null) return imageStoreSupport;
  try {
    await apiFetch('/api/images/check', { method: 'POST', body: JSON.stringify({ ids: [] }) });
    imageStoreSupport = true;
  } catch (err) {
    // 404 means a legacy server without the image store. Anything else
    // (offline, bad token) is transient — don't cache a verdict from it.
    if (err instanceof Error && err.message.startsWith('Sync error 404')) {
      imageStoreSupport = false;
      log.warn('sync', 'server has no image store (legacy) — embedding images in list pushes');
    } else {
      throw err;
    }
  }
  return imageStoreSupport;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
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

/** Upload images the server doesn't have yet, one at a time so at most one
 *  image's base64 lives in memory at once. */
async function uploadMissingImages(imageIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(imageIds)];
  if (uniqueIds.length === 0) return;
  const { missing } = (await apiFetch('/api/images/check', {
    method: 'POST',
    body: JSON.stringify({ ids: uniqueIds }),
  })) as { missing: string[] };
  for (const id of missing) {
    const img = await localDb.images.get(id);
    if (!img) continue;
    await apiFetch(`/api/images/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        mimeType: img.mimeType,
        originalFilename: img.originalFilename,
        createdAt: img.createdAt,
        dataUrl: await blobToDataUrl(img.blob),
      }),
    });
  }
  if (missing.length > 0) log.info('sync', `uploaded ${missing.length} image(s) to store`);
}

/** Fetch images referenced by pulled characters but absent locally. Failures
 *  are per-image and non-fatal — the card renders imageless until a later
 *  pull retries. */
async function downloadMissingImages(imageIds: string[]): Promise<void> {
  for (const id of imageIds) {
    if (await localDb.images.get(id)) continue;
    try {
      const img = (await apiFetch(`/api/images/${id}`)) as {
        mimeType: string; originalFilename: string; createdAt: number; dataUrl: string;
      };
      await localDb.images.put({
        id,
        blob: dataUrlToBlob(img.dataUrl),
        mimeType: img.mimeType,
        originalFilename: img.originalFilename,
        createdAt: img.createdAt,
      });
    } catch (err) {
      log.warn('sync', `image ${id} unavailable on server: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ── Server stamps ──────────────────────────────────────────────────────────
// The server assigns `updated_at` from its own clock on every PUT. The local
// `tierList.updatedAt` is a *client* clock over *content* — the two are not
// comparable. We remember the last server stamp we've seen per list (from a
// push response or a pull) and only pull when the remote stamp moves past it.

function stampKey(listId: string) {
  return `syncStamp:${listId}`;
}

async function getServerStamp(listId: string): Promise<number> {
  const row = await localDb.meta.get(stampKey(listId));
  return typeof row?.value === 'number' ? row.value : 0;
}

// ── Pending deletions ──────────────────────────────────────────────────────
// Deleting a list locally must reach the server, or the next pull re-imports
// it. Persisted in localStorage so a tab close before the flush doesn't lose
// the deletion. (Remote→local deletion propagation is deliberately not done:
// an empty or rebuilt server DB would look identical to "everything was
// deleted elsewhere" and mass-delete local data.)

const STORAGE_KEY_DELETED = 'ptl_sync_deleted';

function getPendingDeletes(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DELETED);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function setPendingDeletes(ids: Set<string>) {
  if (ids.size === 0) {
    localStorage.removeItem(STORAGE_KEY_DELETED);
  } else {
    localStorage.setItem(STORAGE_KEY_DELETED, JSON.stringify([...ids]));
  }
}

/** Push local tier lists to the server. When `listIds` is given, only those
 *  are uploaded — enables auto-sync to upload only the list that changed. */
export async function syncPush(listIds?: string[]): Promise<{ pushed: number }> {
  // Propagate local deletions first so a pull can't resurrect them.
  const pendingDeletes = getPendingDeletes();
  for (const id of pendingDeletes) {
    if (await localDb.tierLists.get(id)) {
      // List was re-created since (import/restore) — it'll be pushed normally.
      pendingDeletes.delete(id);
      setPendingDeletes(pendingDeletes);
      continue;
    }
    await apiFetch(`/api/lists/${id}`, { method: 'DELETE' });
    pendingDeletes.delete(id);
    setPendingDeletes(pendingDeletes);
    await localDb.meta.delete(stampKey(id));
    log.info('sync', `propagated deletion: ${id}`);
  }

  const allLists = await localDb.tierLists.toArray();
  const tierLists = listIds ? allLists.filter((tl) => listIds.includes(tl.id)) : allLists;
  const useImageStore = tierLists.length > 0 ? await serverHasImageStore() : true;
  let pushed = 0;

  for (const tl of tierLists) {
    // Export data scoped to this tier list
    const characters = await localDb.characters.where('tierListId').equals(tl.id).toArray();
    const relationships = await localDb.relationships.where('tierListId').equals(tl.id).toArray();
    const imageIds = characters.map((c) => c.imageId).filter((id): id is string => !!id);

    const embeddedImages: Array<{
      id: string; mimeType: string; originalFilename: string; createdAt: number; dataUrl: string;
    }> = [];
    if (useImageStore) {
      // Upload before the list PUT so a pull never sees list data whose
      // images aren't fetchable yet.
      await uploadMissingImages(imageIds);
    } else {
      // Legacy server: embed every image in the list payload. Serialized
      // sequentially — the resulting strings all coexist in `data` anyway,
      // but there's no need to also hold every FileReader at once.
      for (const id of imageIds) {
        const img = await localDb.images.get(id);
        if (!img) continue;
        embeddedImages.push({
          id: img.id,
          mimeType: img.mimeType,
          originalFilename: img.originalFilename,
          createdAt: img.createdAt,
          dataUrl: await blobToDataUrl(img.blob),
        });
      }
    }

    const data = {
      tierList: tl,
      characters,
      relationships,
      images: embeddedImages,
    };

    const res: { updated_at?: number } = await apiFetch(`/api/lists/${tl.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: tl.name, data: JSON.stringify(data) }),
    });
    if (typeof res.updated_at === 'number') {
      await localDb.meta.put({ key: stampKey(tl.id), value: res.updated_at });
    }
    pushed++;
    log.info('sync', `pushed: ${tl.name}`);
  }

  return { pushed };
}

/** Pull all tier lists from the server and merge */
export async function syncPull(): Promise<{ pulled: number }> {
  const remoteLists: Array<{ id: string; name: string; updated_at: number }> = await apiFetch('/api/lists');
  let pulled = 0;

  const pendingDeletes = getPendingDeletes();
  for (const remote of remoteLists) {
    // Deleted locally, deletion not yet propagated — don't resurrect it.
    if (pendingDeletes.has(remote.id)) continue;

    const local = await localDb.tierLists.get(remote.id);
    // Pull only if the server's stamp moved past the last one we saw (i.e.
    // some device pushed since our last contact) or the list is new to us.
    if (local && remote.updated_at <= (await getServerStamp(remote.id))) continue;

    // Local unpushed edits win over a concurrent remote change (LWW, push
    // side) — skipping here keeps the pull from destroying them; the pending
    // or in-flight push will overwrite the remote version shortly.
    if (local && (dirtyIds.has(remote.id) || inFlightIds.has(remote.id))) {
      log.warn('sync', `skipped pull of "${remote.name}" — local edits pending push`);
      continue;
    }

    const full = await apiFetch(`/api/lists/${remote.id}`);
    const data = JSON.parse(full.data);

    // Mute only for the duration of the local write transaction — a global
    // mute across the network awaits would swallow genuine user edits made
    // while the pull is in flight.
    muted = true;
    try {
      await localDb.transaction('rw', [localDb.tierLists, localDb.characters, localDb.relationships, localDb.images, localDb.meta], async () => {
        // Clear existing data for this list
        await localDb.characters.where('tierListId').equals(remote.id).delete();
        await localDb.relationships.where('tierListId').equals(remote.id).delete();

        // Import — strip the legacy evidenceIds field off any relationships
        // coming from a pre-v6 server snapshot.
        await localDb.tierLists.put(data.tierList);
        if (data.characters?.length) await localDb.characters.bulkPut(data.characters);
        if (data.relationships?.length) {
          const cleaned = (data.relationships as Array<Record<string, unknown>>).map((r) => {
            const copy = { ...r };
            delete copy.evidenceIds;
            return copy;
          });
          await localDb.relationships.bulkPut(
            cleaned as unknown as Parameters<typeof localDb.relationships.bulkPut>[0],
          );
        }

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

        await localDb.meta.put({ key: stampKey(remote.id), value: remote.updated_at });
      });
    } finally {
      muted = false;
    }

    // New-format list data carries no image payloads — fetch any referenced
    // images we don't have from the image store. (Outside the transaction:
    // Dexie transactions can't span network awaits. The images table has no
    // sync hooks, so these puts can't re-dirty the list.)
    const wantedImageIds = [
      ...new Set(
        ((data.characters ?? []) as Array<{ imageId?: string | null }>)
          .map((c) => c.imageId)
          .filter((id): id is string => !!id),
      ),
    ];
    const missingLocally: string[] = [];
    for (const id of wantedImageIds) {
      if (!(await localDb.images.get(id))) missingLocally.push(id);
    }
    if (missingLocally.length > 0 && (await serverHasImageStore())) {
      await downloadMissingImages(missingLocally);
    }

    pulled++;
    log.info('sync', `pulled: ${remote.name}`);
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
const PUSH_RETRY_MS = 15000;
const REFOCUS_PULL_THRESHOLD_MS = 5000;

let initialized = false;
let muted = false;
let pushTimer: number | null = null;
let dirtyIds = new Set<string>();
// Ids being uploaded by the currently in-flight push. Tracked separately from
// dirtyIds (which flushPush drains up front) so a concurrent pull still knows
// these lists have local state the server hasn't seen yet.
let inFlightIds = new Set<string>();
let pushing = false;
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

/** A tier list was deleted locally — queue the deletion for the server. */
function markDeleted(listId?: string) {
  if (muted) return;
  if (!getSyncConfig()) return;
  if (!listId) return;
  const pending = getPendingDeletes();
  pending.add(listId);
  setPendingDeletes(pending);
  dirtyIds.delete(listId);
  setStatus('syncing');
  if (pushTimer) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(flushPush, PUSH_DEBOUNCE_MS);
}

async function flushPush() {
  pushTimer = null;
  // At most one push in flight. Without this guard, edits made during a slow
  // upload spawned additional concurrent syncPush calls, each holding its own
  // full serialization of the list payload — during rapid editing of a large
  // list these stacked without bound (observed eating tens of GB of RAM).
  // Edits arriving mid-push just re-dirty their ids; the finally block below
  // schedules a follow-up flush for them.
  if (pushing) return;
  if (!getSyncConfig()) return;
  if (dirtyIds.size === 0 && getPendingDeletes().size === 0) {
    setStatus('synced');
    return;
  }
  pushing = true;
  const ids = [...dirtyIds];
  dirtyIds = new Set();
  inFlightIds = new Set(ids);
  setStatus('syncing');
  try {
    await syncPush(ids); // an empty ids array still flushes pending deletions
    setStatus(dirtyIds.size === 0 ? 'synced' : 'syncing');
    log.info('sync', `auto-pushed ${ids.length} list(s)`);
  } catch (err) {
    // Restore dirtiness and retry on a timer — without it, unpushed edits sit
    // local-only until the next edit, and a pull could overwrite them.
    ids.forEach((id) => dirtyIds.add(id));
    setStatus('offline');
    log.warn('sync', `auto-push failed, retrying in ${PUSH_RETRY_MS / 1000}s: ${err instanceof Error ? err.message : String(err)}`);
    if (pushTimer) window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(flushPush, PUSH_RETRY_MS);
  } finally {
    pushing = false;
    inFlightIds = new Set();
    // Ids dirtied while this push was in flight had their timer call bounce
    // off the guard above — make sure they get a flush.
    if (dirtyIds.size > 0 && pushTimer == null) {
      pushTimer = window.setTimeout(flushPush, PUSH_DEBOUNCE_MS);
    }
  }
}

async function pullSilently() {
  if (!getSyncConfig()) return;
  setStatus('syncing');
  try {
    // Flush unpushed edits and deletions first: syncPull skips dirty lists to
    // protect them, so pushing first lets the pull see a converged server.
    if (dirtyIds.size > 0 || getPendingDeletes().size > 0) {
      await flushPush();
    }
    await syncPull();
    setStatus(dirtyIds.size === 0 ? 'synced' : 'syncing');
  } catch (err) {
    setStatus('offline');
    log.warn('sync', `auto-pull failed: ${err instanceof Error ? err.message : String(err)}`);
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
  // A deleted list can't be pushed (it no longer exists locally) — it needs
  // an explicit server-side DELETE, or the next pull resurrects it.
  localDb.tierLists.hook('deleting', (_pk, obj) => { markDeleted(getListIdFrom(obj)); });

  localDb.characters.hook('creating', (_pk, obj) => { markDirty(getListIdFrom(obj)); });
  localDb.characters.hook('updating', (_mods, _pk, obj) => { markDirty(getListIdFrom(obj)); });
  localDb.characters.hook('deleting', (_pk, obj) => { markDirty(getListIdFrom(obj)); });

  localDb.relationships.hook('creating', (_pk, obj) => { markDirty(getListIdFrom(obj)); });
  localDb.relationships.hook('updating', (_mods, _pk, obj) => { markDirty(getListIdFrom(obj)); });
  localDb.relationships.hook('deleting', (_pk, obj) => { markDirty(getListIdFrom(obj)); });

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
    setPendingDeletes(new Set());
    if (pushTimer) { window.clearTimeout(pushTimer); pushTimer = null; }
    return;
  }
  setStatus(dirtyIds.size === 0 ? 'synced' : 'syncing');
}
