import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { Relationship, Character } from '../types';
import { resolveUnique } from '../lib/fuzzy-match';
import { parseChain, isParseError, type ParsedPair } from '../lib/relationship-parser';
import { buildGraph, detectCycles, findUnsatisfiableCycle } from '../lib/graph';
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

  const cyclePath = findUnsatisfiableCycle(graph, superiorId, inferiorId);
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
//
// The state maintains the adjacency, strictness map, and longest-chain
// level map *incrementally* — a 50-pair paste used to rebuild all of those
// 50× per call; now each add just propagates from the newly-added edge.

interface DryRunState {
  byPair: Set<string>;
  charMap: Map<string, Character>;
  adj: Map<string, Set<string>>;
  edgeStrict: Map<string, boolean>;
  /** Longest-chain depth ending at each node; level+1 = tiers needed for that tail. */
  level: Map<string, number>;
  /** Plain rel list, kept so overflow errors can reconstruct the offending chain. */
  rels: Array<{ superiorId: string; inferiorId: string; strict: boolean }>;
}

function ensureNode(state: DryRunState, id: string) {
  if (!state.adj.has(id)) {
    state.adj.set(id, new Set());
    state.level.set(id, 0);
  }
}

function initDryRun(existing: Relationship[], characters: Character[]): DryRunState {
  const state: DryRunState = {
    byPair: new Set(),
    charMap: new Map(characters.map((c) => [c.id, c])),
    adj: new Map(),
    edgeStrict: new Map(),
    level: new Map(),
    rels: [],
  };
  for (const r of existing) {
    const strict = r.strict ?? false;
    ensureNode(state, r.superiorId);
    ensureNode(state, r.inferiorId);
    state.adj.get(r.superiorId)!.add(r.inferiorId);
    state.edgeStrict.set(`${r.superiorId}->${r.inferiorId}`, strict);
    state.rels.push({ superiorId: r.superiorId, inferiorId: r.inferiorId, strict });
    state.byPair.add(`${r.superiorId}->${r.inferiorId}`);
  }
  // One-shot fixpoint to populate levels from existing edges.
  const MAX = Math.max(100, state.adj.size * state.adj.size + 1);
  let changed = true;
  let iter = 0;
  while (changed && iter < MAX) {
    changed = false;
    iter++;
    for (const r of state.rels) {
      const si = state.level.get(r.superiorId)!;
      const ii = state.level.get(r.inferiorId)!;
      const gap = r.strict ? 1 : 0;
      if (si + gap > ii) {
        state.level.set(r.inferiorId, si + gap);
        changed = true;
      }
    }
  }
  return state;
}

function forkDryRun(state: DryRunState): DryRunState {
  return {
    byPair: new Set(state.byPair),
    charMap: state.charMap,
    adj: new Map([...state.adj].map(([k, v]) => [k, new Set(v)])),
    edgeStrict: new Map(state.edgeStrict),
    level: new Map(state.level),
    rels: [...state.rels],
  };
}

function restoreDryRun(dst: DryRunState, src: DryRunState) {
  dst.byPair = new Set(src.byPair);
  dst.adj = new Map([...src.adj].map(([k, v]) => [k, new Set(v)]));
  dst.edgeStrict = new Map(src.edgeStrict);
  dst.level = new Map(src.level);
  dst.rels = [...src.rels];
}

/** Find a strict cycle (SCC with a strict edge, or a strict self-loop). */
function findStrictCycle(
  rels: Array<{ superiorId: string; inferiorId: string; strict: boolean }>,
): string[] | null {
  for (const r of rels) {
    if (r.superiorId === r.inferiorId && r.strict) return [r.superiorId];
  }
  const graph = buildGraph(
    rels.map((r, i) => ({
      id: `c-${i}`,
      tierListId: '',
      superiorId: r.superiorId,
      inferiorId: r.inferiorId,
      strict: r.strict,
      createdAt: 0,
    })),
  );
  const sccs = detectCycles(graph);
  for (const scc of sccs) {
    const set = new Set(scc);
    const hasStrict = rels.some(
      (r) => r.strict && set.has(r.superiorId) && set.has(r.inferiorId),
    );
    if (hasStrict) return scc;
  }
  return null;
}

function describeChainFailure(
  state: DryRunState,
  superiorId: string,
  inferiorId: string,
  strict: boolean,
  tierCount: number,
): string {
  const allRelsPlain = [
    ...state.rels,
    { superiorId, inferiorId, strict },
  ];
  // Safety net: if the final state contains a strict cycle the chain-length
  // fixpoint diverges and reports a nonsense number. Catch that explicitly.
  const cycle = findStrictCycle(allRelsPlain);
  if (cycle) {
    const names = cycle.map((id) => state.charMap.get(id)?.name ?? id);
    const loop = cycle.length === 1 ? `${names[0]} > ${names[0]}` : `${names.join(' → ')} → ${names[0]}`;
    return `Creates an impossible cycle (some chain of "greater than" loops back on itself): ${loop}. Remove or weaken one of the relationships in that loop.`;
  }

  const allRels = allRelsPlain.map((r, i) => ({
    id: `dry-${i}`,
    tierListId: '',
    superiorId: r.superiorId,
    inferiorId: r.inferiorId,
    strict: r.strict,
    createdAt: 0,
  }));
  const needed = maxChainLength(allRels);
  const path = longestChainPath(allRels);
  const names = path.map((id) => state.charMap.get(id)?.name ?? id);
  const relByPair = new Map<string, boolean>();
  for (const r of allRels) {
    relByPair.set(`${r.superiorId}->${r.inferiorId}`, r.strict);
  }
  let chainStr = names[0] ?? '';
  for (let i = 1; i < path.length; i++) {
    const op = relByPair.get(`${path[i - 1]}->${path[i]}`) ? '>' : '>=';
    chainStr += ` ${op} ${names[i]}`;
  }
  return `Chain would need ${needed} tiers but the list only has ${tierCount}: ${chainStr}`;
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

  ensureNode(state, superiorId);
  ensureNode(state, inferiorId);

  const cyclePath = findUnsatisfiableCycle(state.adj, superiorId, inferiorId);
  if (cyclePath) {
    const names = cyclePath.map((id) => state.charMap.get(id)?.name ?? id);
    return {
      ok: false,
      reason: `Would create a cycle: ${names.join(' > ')} > ${names[0]}`,
    };
  }

  // Simulate the level propagation in a shadow map before committing.
  // If the shadow detects overflow, we reject without touching state.
  const gap = strict ? 1 : 0;
  const supLevel = state.level.get(superiorId)!;
  const curInfLevel = state.level.get(inferiorId)!;
  const newInfLevel = Math.max(curInfLevel, supLevel + gap);

  if (newInfLevel > tierCount - 1) {
    return { ok: false, reason: describeChainFailure(state, superiorId, inferiorId, strict, tierCount) };
  }

  // Commit the edge + node updates first so adj/edgeStrict are consistent
  // for any future adds in the same group. Overflow rollback handled below.
  state.adj.get(superiorId)!.add(inferiorId);
  state.edgeStrict.set(key, strict);
  state.rels.push({ superiorId, inferiorId, strict });
  state.byPair.add(key);

  if (newInfLevel === curInfLevel) {
    // New edge slack enough that nothing shifts — no BFS needed.
    return { ok: true, isNew: true };
  }

  // Propagate from inferiorId; track level changes in a shadow and only
  // commit them back if no overflow. BFS terminates because non-strict
  // cycles have gap 0 (no growth) and strict cycles were rejected above.
  // The iteration cap is a safety net — if the cycle check ever misses a
  // case (as it did before v2 of findUnsatisfiableCycle), we still exit
  // cleanly instead of spinning.
  const shadow = new Map<string, number>();
  shadow.set(inferiorId, newInfLevel);
  const queue: string[] = [inferiorId];
  const MAX_STEPS = Math.max(1000, state.adj.size * tierCount * 2);
  let steps = 0;

  function rollback() {
    state.adj.get(superiorId)!.delete(inferiorId);
    state.edgeStrict.delete(key);
    state.rels.pop();
    state.byPair.delete(key);
  }

  while (queue.length > 0) {
    if (++steps > MAX_STEPS) {
      rollback();
      return {
        ok: false,
        reason: describeChainFailure(state, superiorId, inferiorId, strict, tierCount),
      };
    }
    const node = queue.shift()!;
    const nodeLevel = shadow.get(node)!;
    for (const child of state.adj.get(node) ?? []) {
      const edgeGap = state.edgeStrict.get(`${node}->${child}`) ? 1 : 0;
      const needed = nodeLevel + edgeGap;
      const existing = shadow.get(child) ?? state.level.get(child)!;
      if (needed > existing) {
        if (needed > tierCount - 1) {
          rollback();
          return {
            ok: false,
            reason: describeChainFailure(state, superiorId, inferiorId, strict, tierCount),
          };
        }
        shadow.set(child, needed);
        queue.push(child);
      }
    }
  }

  for (const [id, lvl] of shadow) state.level.set(id, lvl);
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

    // Dry-run the group with a saved fork so partial failure rolls back cleanly.
    const snapshot = forkDryRun(dryState);
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
      restoreDryRun(dryState, snapshot);
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
