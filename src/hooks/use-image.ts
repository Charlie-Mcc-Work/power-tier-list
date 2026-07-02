import { useCallback, useSyncExternalStore } from 'react';
import { db } from '../db/database';

/**
 * Shared image cache.
 *
 * Images are immutable per id (setCharacterImage allocates a fresh uuid rather
 * than mutating), so once loaded an object URL can be reused for the lifetime
 * of the session. With 1k+ cards the per-card db.images.get + createObjectURL
 * pattern was the dominant startup cost — every card hit IDB independently and
 * minted its own URL. This module batches all requests within a microtask into
 * a single bulkGet, shares one URL per id, and notifies subscribers via
 * useSyncExternalStore.
 */

type Entry = {
  url: string | null;
  loaded: boolean;
};

const cache = new Map<string, Entry>();
const subscribers = new Map<string, Set<() => void>>();
let pending: Set<string> | null = null;

function notify(id: string) {
  const subs = subscribers.get(id);
  if (!subs) return;
  for (const fn of subs) fn();
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
    rows.forEach((row, i) => {
      const id = ids[i];
      const entry = cache.get(id);
      if (!entry) return;
      if (row?.blob) {
        entry.url = URL.createObjectURL(row.blob);
      }
      entry.loaded = true;
      notify(id);
    });
  } catch (err) {
    console.warn('[useImage] bulkGet failed; retrying shortly', err);
    // Drop the entries so they can be re-requested — marking them loaded
    // would turn a transient IDB failure into blank images for the whole
    // session. Retry automatically for ids still on screen.
    for (const id of ids) cache.delete(id);
    setTimeout(() => {
      for (const id of ids) {
        if (subscribers.has(id) && !cache.has(id)) ensureRequested(id);
      }
    }, 2000);
  }
}

function ensureRequested(id: string) {
  if (cache.has(id)) return;
  cache.set(id, { url: null, loaded: false });
  if (!pending) scheduleFlush();
  pending!.add(id);
}

function subscribe(id: string, listener: () => void): () => void {
  let set = subscribers.get(id);
  if (!set) {
    set = new Set();
    subscribers.set(id, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) subscribers.delete(id);
  };
}

/**
 * Invalidate a cached image (e.g., after the user replaces a character's
 * image). Revokes the old URL so the blob can be GC'd and forces the next
 * useImage(id) to refetch.
 */
export function invalidateImage(id: string) {
  const entry = cache.get(id);
  if (entry?.url) URL.revokeObjectURL(entry.url);
  cache.delete(id);
  notify(id);
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
