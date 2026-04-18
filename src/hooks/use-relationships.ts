import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { Relationship, Confidence, Character } from '../types';
import { findBestMatch } from '../lib/fuzzy-match';
import {
  parseRelationshipStatement,
  isParseError,
} from '../lib/relationship-parser';

export function useRelationships(): Relationship[] {
  return useLiveQuery(() => db.relationships.toArray(), []) ?? [];
}

export async function addRelationship(
  superiorId: string,
  inferiorId: string,
  confidence: Confidence,
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
    confidence,
    evidenceIds: [],
    note,
    createdAt: Date.now(),
  });
  return id;
}

export async function addRelationshipFromStatement(
  statement: string,
  characters: Character[],
): Promise<{ id: string } | { error: string }> {
  const result = parseRelationshipStatement(statement);
  if (isParseError(result)) return result;

  const superior = findBestMatch(result.superiorName, characters);
  const inferior = findBestMatch(result.inferiorName, characters);

  if (!superior) return { error: `Character not found: "${result.superiorName}"` };
  if (!inferior) return { error: `Character not found: "${result.inferiorName}"` };
  if (superior.id === inferior.id) return { error: 'Cannot compare a character to themselves' };

  const id = await addRelationship(superior.id, inferior.id, result.confidence);
  return { id };
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

    const result = await addRelationshipFromStatement(statement, characters);
    if ('error' in result) {
      errors.push({ line: i + 1, text: statement, error: result.error });
    } else {
      added++;
    }
  }

  return { added, errors };
}

export async function deleteRelationship(id: string): Promise<void> {
  await db.relationships.delete(id);
}

export async function updateRelationshipConfidence(
  id: string,
  confidence: Confidence,
): Promise<void> {
  await db.relationships.update(id, { confidence });
}
