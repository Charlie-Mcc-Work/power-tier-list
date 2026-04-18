import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { Relationship, Character } from '../types';
import { findBestMatch } from '../lib/fuzzy-match';
import { parseChain, isParseError } from '../lib/relationship-parser';

export function useRelationships(): Relationship[] {
  return useLiveQuery(() => db.relationships.toArray(), []) ?? [];
}

export async function addRelationship(
  superiorId: string,
  inferiorId: string,
  strict: boolean,
  note?: string,
): Promise<string> {
  // Check for duplicate
  const existing = await db.relationships
    .where('[superiorId+inferiorId]')
    .equals([superiorId, inferiorId])
    .first();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  await db.relationships.add({
    id,
    superiorId,
    inferiorId,
    strict,
    evidenceIds: [],
    note,
    createdAt: Date.now(),
  });
  return id;
}

/**
 * Parse a chain statement (e.g. "A > B > C") and create all relationships.
 */
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

    if (!sup) {
      errors.push(`Not found: "${pair.superiorName}"`);
      continue;
    }
    if (!inf) {
      errors.push(`Not found: "${pair.inferiorName}"`);
      continue;
    }
    if (sup.id === inf.id) {
      errors.push(`Cannot compare "${pair.superiorName}" to themselves`);
      continue;
    }

    await addRelationship(sup.id, inf.id, pair.strict, note);
    added++;
  }

  return { added, errors };
}

/**
 * Process multiple lines of relationship statements (chains supported).
 */
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
