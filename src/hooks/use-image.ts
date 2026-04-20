import { useEffect, useState } from 'react';
import { db } from '../db/database';

/**
 * Loads an image blob from IndexedDB and returns a stable object URL.
 *
 * Notes:
 *  - Images in this app are immutable for a given id (see use-characters.ts:
 *    setCharacterImage creates a fresh uuid rather than mutating).  So we fetch
 *    once per id and skip live-query re-subscription — that avoided the URL
 *    churn the previous version suffered from on every table change.
 *  - The URL is revoked on cleanup so blobs can be GC'd.
 */
export function useImage(imageId: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imageId) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    db.images.get(imageId).then((image) => {
      if (cancelled || !image?.blob) return;
      objectUrl = URL.createObjectURL(image.blob);
      setUrl(objectUrl);
    }).catch((err) => {
      console.warn('[useImage] fetch failed for', imageId, err);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [imageId]);

  return imageId ? url : null;
}
