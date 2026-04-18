import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { Relationship, Character } from '../types';
import { findBestMatch } from '../lib/fuzzy-match';
import { parseChain, isParseError } from '../lib/relationship-parser';
import { buildGraph, findUnsatisfiableCycle } from '../lib/graph';
import { getActiveTierListId } from './use-tier-list';

export function useRelationships(): Relationship[] {
  const tierListId = getActiveTierListId();
  return useLiveQuery(
    () => db.relationships.where('tierListId').equals(tierListId).toArray(),
    [tierListId],
  ) ?? [];
}

export async function addRelationship(
  superiorId: string,
  inferiorId: string,
  strict: boolean,
  note?: string,
): Promise<{ id: string } | { cycleError: string }> {
  const tierListId = getActiveTierListId();

  const existing = await db.relationships
    .where('[superiorId+inferiorId]')
    .equals([superiorId, inferiorId])
    .first();
  if (existing) return { id: existing.id };

  // Cycle check scoped to this tier list's relationships
  const allRels = await db.relationships.where('tierListId').equals(tierListId).toArray();
  const graph = buildGraph(allRels);
  if (!graph.has(superiorId)) graph.set(superiorId, new Set());
  if (!graph.has(inferiorId)) graph.set(inferiorId, new Set());

  const edgeStrictness = new Map<string, boolean>();
  for (const rel of allRels) {
    edgeStrictness.set(`${rel.superiorId}->${rel.inferiorId}`, rel.strict ?? false);
  }

  const cyclePath = findUnsatisfiableCycle(graph, edgeStrictness, superiorId, inferiorId, strict);
  if (cyclePath) {
    const chars = await db.characters.bulkGet(cyclePath);
    const names = cyclePath.map((id, i) => chars[i]?.name ?? id);
    return {
      cycleError: `Would create a cycle: ${names.join(' > ')} > ${names[0]}`,
    };
  }

  const id = crypto.randomUUID();
  await db.relationships.add({
    id,
    tierListId,
    superiorId,
    inferiorId,
    strict,
    evidenceIds: [],
    note,
    createdAt: Date.now(),
  });
  return { id };
}

export async function addRelationshipsFromChain(
  chain: string,
  characters: Character[],
  note?: string,
): Promise<{ added: number; errors: string[] }> {
  const parsed = parseChain(chain);
  if (isParseError(parsed)) return { added: 0, errors: [parsed.error] };

  let added = 0;
  const errors: string[] = [];

  for (const pair of parsed.pairs) {
    const sup = findBestMatch(pair.superiorName, characters);
    const inf = findBestMatch(pair.inferiorName, characters);

    if (!sup) { errors.push(`Not found: "${pair.superiorName}"`); continue; }
    if (!inf) { errors.push(`Not found: "${pair.inferiorName}"`); continue; }
    if (sup.id === inf.id) { errors.push(`Cannot compare "${pair.superiorName}" to themselves`); continue; }

    const result = await addRelationship(sup.id, inf.id, pair.strict, note);
    if ('cycleError' in result) {
      errors.push(result.cycleError);
    } else {
      added++;
    }
  }

  return { added, errors };
}

export async function addBulkRelationshipsFromStatements(
  statements: string[],
  characters: Character[],
): Promise<{ added: number; errors: Array<{ line: number; text: string; error: string }> }> {
  const errors: Array<{ line: number; text: string; error: string }> = [];
  let added = 0;

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i].trim();
    if (!statement || statement.startsWith('#') || statement.startsWith('//')) continue;

    const result = await addRelationshipsFromChain(statement, characters);
    added += result.added;
    for (const err of result.errors) {
      errors.push({ line: i + 1, text: statement, error: err });
    }
  }

  return { added, errors };
}

export async function deleteRelationship(id: string): Promise<void> {
  await db.relationships.delete(id);
}

export async function updateRelationshipStrict(
  id: string,
  strict: boolean,
): Promise<void> {
  await db.relationships.update(id, { strict });
}
