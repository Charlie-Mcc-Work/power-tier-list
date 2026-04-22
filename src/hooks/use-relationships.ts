import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { Relationship, Character } from '../types';
import { resolveUnique } from '../lib/fuzzy-match';
import { parseChain, isParseError, type ParsedPair } from '../lib/relationship-parser';
import { buildGraph, findUnsatisfiableCycle } from '../lib/graph';
import { maxChainLength, longestChainPath } from '../lib/enforce-constraints';
import { getActiveTierListId } from './use-tier-list';
import { useUIStore } from '../stores/ui-store';
import { DEFAULT_TIER_DEFS } from '../types';

export function useRelationships(): Relationship[] {
  const tierListId = useUIStore((s) => s.activeTierListId) ?? 'default';
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

// ── Dry-run cycle checker ──────────────────────────────────────────────
// Used so we can validate a *group* of additions (e.g. the two mirror pairs
// produced by `=`) against the current graph PLUS previously-accepted pairs
// in the same group — without writing anything until every pair in the
// group is known to be safe.

interface DryRunState {
  rels: Array<{ superiorId: string; inferiorId: string; strict: boolean }>;
  byPair: Set<string>;
  charMap: Map<string, Character>;
}

function initDryRun(existing: Relationship[], characters: Character[]): DryRunState {
  return {
    rels: existing.map((r) => ({
      superiorId: r.superiorId,
      inferiorId: r.inferiorId,
      strict: r.strict ?? false,
    })),
    byPair: new Set(existing.map((r) => `${r.superiorId}->${r.inferiorId}`)),
    charMap: new Map(characters.map((c) => [c.id, c])),
  };
}

function cloneDryRun(state: DryRunState): DryRunState {
  return { rels: [...state.rels], byPair: new Set(state.byPair), charMap: state.charMap };
}

function dryRunAdd(
  state: DryRunState,
  superiorId: string,
  inferiorId: string,
  strict: boolean,
  tierCount: number,
): { ok: true; isNew: boolean } | { ok: false; reason: string } {
  const key = `${superiorId}->${inferiorId}`;
  if (state.byPair.has(key)) return { ok: true, isNew: false };

  // Build an adjacency map over the current dry-run state just for this check.
  const graph = new Map<string, Set<string>>();
  const edgeStrictness = new Map<string, boolean>();
  for (const r of state.rels) {
    if (!graph.has(r.superiorId)) graph.set(r.superiorId, new Set());
    if (!graph.has(r.inferiorId)) graph.set(r.inferiorId, new Set());
    graph.get(r.superiorId)!.add(r.inferiorId);
    edgeStrictness.set(`${r.superiorId}->${r.inferiorId}`, r.strict);
  }
  if (!graph.has(superiorId)) graph.set(superiorId, new Set());
  if (!graph.has(inferiorId)) graph.set(inferiorId, new Set());

  const cyclePath = findUnsatisfiableCycle(graph, edgeStrictness, superiorId, inferiorId, strict);
  if (cyclePath) {
    const names = cyclePath.map((id) => state.charMap.get(id)?.name ?? id);
    return {
      ok: false,
      reason: `Would create a cycle: ${names.join(' > ')} > ${names[0]}`,
    };
  }

  state.rels.push({ superiorId, inferiorId, strict });
  state.byPair.add(key);

  // Reject adds that would force a chain longer than the tier list can hold.
  // Rebuild the check each call — cheap for normal sizes, and it catches
  // chains that only become too long after several earlier adds in a bulk
  // paste (e.g. A>B, B>C, C>D, D>E, E>F, F>G in a 6-tier list — only the
  // last one tips it over, but we still want to name the 7-deep chain).
  const asRels = state.rels.map((r, i) => ({
    id: `dry-${i}`,
    tierListId: '',
    superiorId: r.superiorId,
    inferiorId: r.inferiorId,
    strict: r.strict,
    evidenceIds: [],
    createdAt: 0,
  }));
  const needed = maxChainLength(asRels);
  if (needed > tierCount) {
    // Roll back so the caller's state machine stays consistent.
    state.rels.pop();
    state.byPair.delete(key);

    const path = longestChainPath(asRels);
    const names = path.map((id) => state.charMap.get(id)?.name ?? id);
    const relByPair = new Map<string, boolean>();
    for (const r of state.rels) {
      relByPair.set(`${r.superiorId}->${r.inferiorId}`, r.strict);
    }
    // The new edge we just popped isn't in state.rels any more — put it in
    // the lookup so the chain string shows the right operator for it too.
    relByPair.set(`${superiorId}->${inferiorId}`, strict);

    let chainStr = names[0] ?? '';
    for (let i = 1; i < path.length; i++) {
      const op = relByPair.get(`${path[i - 1]}->${path[i]}`) ? '>' : '>=';
      chainStr += ` ${op} ${names[i]}`;
    }
    return {
      ok: false,
      reason: `Chain would need ${needed} tiers but the list only has ${tierCount}: ${chainStr}`,
    };
  }

  return { ok: true, isNew: true };
}

// Identify pairs that came from `=` (or a user-written mirror A>=B, B>=A)
// and should succeed or fail together. Everything else is a singleton group.
function groupMirrorPairs(pairs: ParsedPair[]): ParsedPair[][] {
  const groups: ParsedPair[][] = [];
  const consumed = new Set<number>();
  const norm = (s: string) => s.toLowerCase().trim();
  for (let i = 0; i < pairs.length; i++) {
    if (consumed.has(i)) continue;
    const p = pairs[i];
    if (!p.strict) {
      const j = pairs.findIndex(
        (q, k) =>
          !consumed.has(k) &&
          k !== i &&
          !q.strict &&
          norm(q.superiorName) === norm(p.inferiorName) &&
          norm(q.inferiorName) === norm(p.superiorName),
      );
      if (j >= 0) {
        groups.push([p, pairs[j]]);
        consumed.add(i);
        consumed.add(j);
        continue;
      }
    }
    groups.push([p]);
    consumed.add(i);
  }
  return groups;
}

function describeResolve(
  res: ReturnType<typeof resolveUnique>,
  name: string,
): string | null {
  if (res.kind === 'found') return null;
  if (res.kind === 'notFound') return `Not found: "${name}"`;
  const preview = res.candidates.slice(0, 4).map((c) => c.name).join(', ');
  const more = res.candidates.length > 4 ? `, +${res.candidates.length - 4} more` : '';
  return `Ambiguous: "${name}" could be ${preview}${more} — type the full name`;
}

export async function addRelationshipsFromChain(
  chain: string,
  characters: Character[],
  note?: string,
): Promise<{ added: number; errors: string[] }> {
  const t0 = performance.now();
  const parsed = parseChain(chain);
  if (isParseError(parsed)) return { added: 0, errors: [parsed.error] };

  const tierListId = getActiveTierListId();
  const [allRels, tierList] = await Promise.all([
    db.relationships.where('tierListId').equals(tierListId).toArray(),
    db.tierLists.get(tierListId),
  ]);
  const tierCount = (tierList?.tierDefs ?? DEFAULT_TIER_DEFS).length;
  const dryState = initDryRun(allRels, characters);

  const groups = groupMirrorPairs(parsed.pairs);
  const errors: string[] = [];
  interface PendingAdd {
    superiorId: string;
    inferiorId: string;
    strict: boolean;
  }
  const toAdd: PendingAdd[] = [];

  for (const group of groups) {
    // Resolve all endpoints upfront. Any resolution failure in the group
    // aborts the whole group with one combined error.
    interface Resolved { sup: Character; inf: Character; strict: boolean; pair: ParsedPair }
    const resolved: Resolved[] = [];
    const resolveErrors: string[] = [];
    for (const pair of group) {
      const supRes = resolveUnique(pair.superiorName, characters);
      const infRes = resolveUnique(pair.inferiorName, characters);
      const supErr = describeResolve(supRes, pair.superiorName);
      const infErr = describeResolve(infRes, pair.inferiorName);
      if (supErr) { resolveErrors.push(supErr); continue; }
      if (infErr) { resolveErrors.push(infErr); continue; }
      const sup = (supRes as { kind: 'found'; character: Character }).character;
      const inf = (infRes as { kind: 'found'; character: Character }).character;
      if (sup.id === inf.id) {
        resolveErrors.push(`Cannot compare "${pair.superiorName}" to themselves`);
        continue;
      }
      resolved.push({ sup, inf, strict: pair.strict, pair });
    }
    if (resolveErrors.length > 0) {
      errors.push(...resolveErrors);
      continue;
    }

    // Dry-run the group on a forked state so partial failure doesn't leak.
    const snapshot = cloneDryRun(dryState);
    let failure: string | null = null;
    const groupAdds: PendingAdd[] = [];
    for (const r of resolved) {
      const result = dryRunAdd(dryState, r.sup.id, r.inf.id, r.strict, tierCount);
      if (!result.ok) { failure = result.reason; break; }
      if (result.isNew) {
        groupAdds.push({ superiorId: r.sup.id, inferiorId: r.inf.id, strict: r.strict });
      }
    }

    if (failure) {
      // Roll back the dry-state to what it was before this group.
      dryState.rels = snapshot.rels;
      dryState.byPair = snapshot.byPair;
      if (group.length === 2) {
        const a = resolved[0].sup.name;
        const b = resolved[0].inf.name;
        errors.push(`Can't make ${a} = ${b}: ${failure}`);
      } else {
        errors.push(failure);
      }
      continue;
    }

    toAdd.push(...groupAdds);
  }

  // Commit all accepted adds in a single transaction.
  if (toAdd.length > 0) {
    await db.transaction('rw', db.relationships, async () => {
      const now = Date.now();
      for (const p of toAdd) {
        const existing = await db.relationships
          .where('[superiorId+inferiorId]')
          .equals([p.superiorId, p.inferiorId])
          .first();
        if (existing) continue;
        await db.relationships.add({
          id: crypto.randomUUID(),
          tierListId,
          superiorId: p.superiorId,
          inferiorId: p.inferiorId,
          strict: p.strict,
          evidenceIds: [],
          note,
          createdAt: now,
        });
      }
    });
  }

  const elapsed = performance.now() - t0;
  if (elapsed > 150) {
    console.info(`[relationships] addRelationshipsFromChain took ${Math.round(elapsed)}ms for ${toAdd.length} write(s)`);
  }
  return { added: toAdd.length, errors };
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
