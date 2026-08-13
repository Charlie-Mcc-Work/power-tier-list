import { useCallback, useSyncExternalStore } from 'react';
import { db } from '../db/database';

/**
 * Shared image cache.
 *
 * Images are immutable per id (setCharacterImage allocates a fresh uuid rather
 * than mutating), so a loaded object URL can be shared by every card showing
 * that image. With 1k+ cards the per-card db.images.get + createObjectURL
 * pattern was the dominant startup cost — every card hit IDB independently and
 * minted its own URL. This module batches all requests within a microtask into
 * a single bulkGet, shares one URL per id, and notifies subscribers via
 * useSyncExternalStore.
 *
 * Eviction: an object URL pins its whole blob in memory, so entries are
 * released once no component has subscribed for EVICT_GRACE_MS. The grace
 * period keeps virtualized scrolling and quick list-switches from thrashing
 * refetches, while bounding retained memory to roughly what's on (or near)
 * screen instead of every image ever viewed in the session.
 */

type Entry = {
  url: string | null;
  loaded: boolean;
};

const EVICT_GRACE_MS = 60_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;

const cache = new Map<string, Entry>();
const subscribers = new Map<string, Set<() => void>>();
const evictTimers = new Map<string, ReturnType<typeof setTimeout>>();
let pending: Set<string> | null = null;
let retryDelay = RETRY_BASE_MS;

function notify(id: string) {
  const subs = subscribers.get(id);
  if (!subs) return;
  for (const fn of subs) fn();
}

function cancelEvict(id: string) {
  const timer = evictTimers.get(id);
  if (timer != null) {
    clearTimeout(timer);
    evictTimers.delete(id);
  }
}

function release(id: string) {
  evictTimers.delete(id);
  const entry = cache.get(id);
  if (entry?.url) URL.revokeObjectURL(entry.url);
  cache.delete(id);
}

function scheduleEvict(id: string) {
  cancelEvict(id);
  evictTimers.set(
    id,
    setTimeout(() => {
      // Re-check: a component may have subscribed again since scheduling.
      if (!subscribers.has(id)) release(id);
      else evictTimers.delete(id);
    }, EVICT_GRACE_MS),
  );
}

function scheduleFlush() {
  if (pending) return;
  pending = new Set();
  queueMicrotask(flush);
}

async function flush() {
  const ids = pending ? [...pending] : [];
  pending = null;
  if (ids.length === 0) return;

  try {
    const rows = await db.images.bulkGet(ids);
    retryDelay = RETRY_BASE_MS;
    rows.forEach((row, i) => {
      const id = ids[i];
      const entry = cache.get(id);
      if (!entry) return;
      if (row?.blob) {
        // A stale flush can race a concurrent invalidate + re-request for the
        // same id; never orphan a URL that's already been minted.
        if (entry.url) URL.revokeObjectURL(entry.url);
        entry.url = URL.createObjectURL(row.blob);
      }
      entry.loaded = true;
      notify(id);
    });
  } catch (err) {
    console.warn('[useImage] bulkGet failed; retrying shortly', err);
    // Drop the entries so they can be re-requested — marking them loaded
    // would turn a transient IDB failure into blank images for the whole
    // session. Retry automatically (with backoff) for ids still on screen.
    for (const id of ids) cache.delete(id);
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    setTimeout(() => {
      for (const id of ids) {
        if (subscribers.has(id) && !cache.has(id)) ensureRequested(id);
      }
    }, delay);
  }
}

function ensureRequested(id: string) {
  if (cache.has(id)) return;
  cache.set(id, { url: null, loaded: false });
  if (!pending) scheduleFlush();
  pending!.add(id);
}

function subscribe(id: string, listener: () => void): () => void {
  cancelEvict(id);
  let set = subscribers.get(id);
  if (!set) {
    set = new Set();
    subscribers.set(id, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) {
      subscribers.delete(id);
      scheduleEvict(id);
    }
  };
}

/**
 * Invalidate a cached image (e.g., after the user replaces a character's
 * image). Revokes the old URL so the blob can be GC'd and forces the next
 * useImage(id) to refetch.
 */
export function invalidateImage(id: string) {
  cancelEvict(id);
  const entry = cache.get(id);
  if (entry?.url) URL.revokeObjectURL(entry.url);
  cache.delete(id);
  notify(id);
}

/**
 * Drop the entire cache. Needed whenever the images table is rewritten
 * wholesale (import replace, snapshot restore) — cached URLs would otherwise
 * keep serving pre-import blobs (and pin them in memory) until reload.
 */
export function invalidateAllImages() {
  for (const timer of evictTimers.values()) clearTimeout(timer);
  evictTimers.clear();
  for (const entry of cache.values()) {
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  cache.clear();
  for (const id of [...subscribers.keys()]) notify(id);
}

const EMPTY_UNSUB = () => {};

export function useImage(imageId: string | undefined): string | null {
  if (imageId) ensureRequested(imageId);

  const subscribeForId = useCallback(
    (cb: () => void) => (imageId ? subscribe(imageId, cb) : EMPTY_UNSUB),
    [imageId],
  );
  const getSnapshot = useCallback(
    () => (imageId ? cache.get(imageId)?.url ?? null : null),
    [imageId],
  );

  return useSyncExternalStore(subscribeForId, getSnapshot, () => null);
}
