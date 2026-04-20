import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { Evidence, EvidenceKind } from '../types';
import { getActiveTierListId } from './use-tier-list';
import { useUIStore } from '../stores/ui-store';

export function useEvidence(): Evidence[] {
  const tierListId = useUIStore((s) => s.activeTierListId) ?? 'default';
  return useLiveQuery(
    () => db.evidence.where('tierListId').equals(tierListId).toArray(),
    [tierListId],
  ) ?? [];
}

export function useEvidenceForCharacter(characterId: string | null): Evidence[] {
  return (
    useLiveQuery(
      () =>
        characterId
          ? db.evidence.where('characterIds').equals(characterId).toArray()
          : [],
      [characterId],
    ) ?? []
  );
}

export function useEvidenceForRelationship(relationshipId: string | null): Evidence[] {
  return (
    useLiveQuery(
      () =>
        relationshipId
          ? db.evidence.where('relationshipIds').equals(relationshipId).toArray()
          : [],
      [relationshipId],
    ) ?? []
  );
}

export async function addEvidence(
  kind: EvidenceKind,
  text: string,
  characterIds: string[],
  relationshipIds: string[] = [],
  source?: string,
): Promise<string> {
  const tierListId = getActiveTierListId();
  const id = crypto.randomUUID();
  await db.evidence.add({
    id,
    tierListId,
    kind,
    text,
    characterIds,
    relationshipIds,
    source,
    createdAt: Date.now(),
  });

  for (const relId of relationshipIds) {
    const rel = await db.relationships.get(relId);
    if (rel) {
      await db.relationships.update(relId, {
        evidenceIds: [...rel.evidenceIds, id],
      });
    }
  }

  return id;
}

export async function deleteEvidence(id: string): Promise<void> {
  const evidence = await db.evidence.get(id);
  if (!evidence) return;

  for (const relId of evidence.relationshipIds) {
    const rel = await db.relationships.get(relId);
    if (rel) {
      await db.relationships.update(relId, {
        evidenceIds: rel.evidenceIds.filter((eid) => eid !== id),
      });
    }
  }

  await db.evidence.delete(id);
}

export async function updateEvidence(
  id: string,
  updates: Partial<Pick<Evidence, 'kind' | 'text' | 'source' | 'characterIds' | 'relationshipIds'>>,
): Promise<void> {
  await db.evidence.update(id, updates);
}
