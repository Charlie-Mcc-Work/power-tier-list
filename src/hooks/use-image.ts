import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';

export function useImage(imageId: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);

  const image = useLiveQuery(
    () => (imageId ? db.images.get(imageId) : undefined),
    [imageId],
  );

  useEffect(() => {
    if (!image?.blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(image.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image]);

  return url;
}
