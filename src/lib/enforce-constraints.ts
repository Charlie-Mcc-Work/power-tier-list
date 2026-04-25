import type { Relationship, TierAssignment } from '../types';
import { log } from './logger';
import { detectCycles } from './graph';

function toIdx(tierId: string, tierIds: string[]): number {
  const idx = tierIds.indexOf(tierId);
  return idx >= 0 ? idx : 0;
}
function toTierId(idx: number, tierIds: string[]): string {
  const maxIdx = tierIds.length - 1;
  return tierIds[Math.max(0, Math.min(idx, maxIdx))];
}

// ──────────────────────────────────────────────────────────────────────────
// Shared constraint solver
//
// The model:
//   `A > B`  → tier[A] + 1 <= tier[B]     (A one or more tiers above B)
//   `A >= B` → tier[A]     == tier[B]     (same tier, A before B in position)
//
// Non-strict edges partition characters into equivalence classes (via
// union-find). Every class has a single tier; strict edges cascade between
// classes. A strict edge *within* one class is an inconsistency (A > B but
// A and B are forced to share a tier) — surfaced as a hard error.
// ──────────────────────────────────────────────────────────────────────────

type Constraint = { superiorId: string; inferiorId: string; strict: boolean };

interface SolveResult {
  tierMap: Map<string, number>;
  find: (x: string) => string;
  /** Set when constraints couldn't be satisfied; the tierMap is best-effort. */
  error?: string;
}

interface SolveOptions {
  /** When a strict edge would push past the tier bounds, clamp instead of failing. */
  clampOverflow?: boolean;
}

function solveTiers(
  chars: Iterable<string>,
  rels: Constraint[],
  seed: Map<string, number>,
  fix: Map<string, number>,
  maxIdx: number,
  charNames?: Map<string, string>,
  options: SolveOptions = {},
): SolveResult {
  const charSet = new Set(chars);

  // Union-find over non-strict edges.
  const parent = new Map<string, string>();
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    while (parent.get(x)! !== r) {
      const p = parent.get(x)!;
      parent.set(x, r);
      x = p;
    }
    return r;
  }
  function union(a: string, b: string) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const id of charSet) find(id);
  for (const rel of rels) {
    if (!rel.strict && charSet.has(rel.superiorId) && charSet.has(rel.inferiorId)) {
      union(rel.superiorId, rel.inferiorId);
    }
  }

  // A strict edge inside one class is unsatisfiable (same-tier contradicts gap).
  for (const rel of rels) {
    if (!rel.strict) continue;
    if (!charSet.has(rel.superiorId) || !charSet.has(rel.inferiorId)) continue;
    if (find(rel.superiorId) === find(rel.inferiorId)) {
      const supName = charNames?.get(rel.superiorId) ?? rel.superiorId;
      const infName = charNames?.get(rel.inferiorId) ?? rel.inferiorId;
      const tierMap = seedToTierMap(charSet, seed, find);
      return {
        tierMap,
        find,
        error: `${supName} > ${infName} contradicts a >= chain that forces them into the same tier`,
      };
    }
  }

  // Class-level cycle: strict edges between same-tier groups can form a
  // loop even when no individual rel sits in a graph cycle and no strict
  // edge is within one class. Detect upfront so the cascade doesn't spin
  // forever and we can give the user a useful error.
  const classGraph = new Map<string, Set<string>>();
  for (const rel of rels) {
    if (!rel.strict) continue;
    if (!charSet.has(rel.superiorId) || !charSet.has(rel.inferiorId)) continue;
    const supC = find(rel.superiorId);
    const infC = find(rel.inferiorId);
    if (supC === infC) continue;
    if (!classGraph.has(supC)) classGraph.set(supC, new Set());
    classGraph.get(supC)!.add(infC);
  }
  const classSCCs = detectCycles(classGraph);
  if (classSCCs.length > 0) {
    return {
      tierMap: seedToTierMap(charSet, seed, find),
      find,
      error: 'A `>` relationship combined with `>=` chains forms a tier loop — open the Contradictions view to see which rels conflict',
    };
  }

  // Initial class tiers: fix > seed (take max across class members).
  const compTier = new Map<string, number>();
  for (const id of charSet) {
    const c = find(id);
    const f = fix.get(id);
    if (f != null) {
      const existing = compTier.get(c);
      if (existing != null && existing !== f) {
        return {
          tierMap: seedToTierMap(charSet, seed, find),
          find,
          error: 'Fixed characters in the same >= chain are pinned to different tiers',
        };
      }
      compTier.set(c, f);
    }
  }
  for (const id of charSet) {
    const c = find(id);
    if (compTier.has(c)) continue; // a fix already set this class
    const s = seed.get(id);
    if (s == null) continue;
    const existing = compTier.get(c);
    if (existing == null || s > existing) compTier.set(c, s);
  }
  for (const id of charSet) {
    const c = find(id);
    if (!compTier.has(c)) compTier.set(c, 0);
  }

  const fixedComps = new Set<string>();
  for (const id of fix.keys()) {
    if (charSet.has(id)) fixedComps.add(find(id));
  }

  // Cascade strict edges at class level. (Strict edges within a class
  // would have errored out above — this filter just defends against bad
  // data from making the loop spin.)
  const strictRels = rels.filter(
    (r) =>
      r.strict &&
      charSet.has(r.superiorId) &&
      charSet.has(r.inferiorId) &&
      find(r.superiorId) !== find(r.inferiorId),
  );
  const MAX_ITER = Math.max(100, compTier.size * (maxIdx + 2) * 2 + 10);
  let iter = 0;
  let changed = true;
  while (changed && iter < MAX_ITER) {
    changed = false;
    iter++;
    for (const rel of strictRels) {
      const supC = find(rel.superiorId);
      const infC = find(rel.inferiorId);
      const supT = compTier.get(supC)!;
      const infT = compTier.get(infC)!;
      if (supT + 1 > infT) {
        const canPushInf = !fixedComps.has(infC) && supT + 1 <= maxIdx;
        const canPushSup = !fixedComps.has(supC) && infT - 1 >= 0;
        if (canPushInf) {
          compTier.set(infC, supT + 1);
          changed = true;
        } else if (canPushSup) {
          compTier.set(supC, infT - 1);
          changed = true;
        } else if (options.clampOverflow) {
          // Best-effort: shove inf down as far as the list allows. The
          // inconsistency banner will flag the remaining violation.
          if (!fixedComps.has(infC) && infT < maxIdx) {
            compTier.set(infC, maxIdx);
            changed = true;
          } else {
            // Nothing more to do; leave as-is and bail out of the loop.
            changed = false;
            break;
          }
        } else {
          const supName = charNames?.get(rel.superiorId) ?? rel.superiorId;
          const infName = charNames?.get(rel.inferiorId) ?? rel.inferiorId;
          const boundary = supT + 1 > maxIdx ? 'bottom' : 'top';
          return {
            tierMap: compToTierMap(charSet, compTier, find),
            find,
            error: `${supName} > ${infName} — no room at the ${boundary} of the list`,
          };
        }
      }
    }
  }

  if (iter >= MAX_ITER) {
    return {
      tierMap: compToTierMap(charSet, compTier, find),
      find,
      error: 'Constraints could not be satisfied (iteration cap)',
    };
  }

  return { tierMap: compToTierMap(charSet, compTier, find), find };
}

function seedToTierMap(
  charSet: Set<string>,
  seed: Map<string, number>,
  find: (x: string) => string,
): Map<string, number> {
  const tm = new Map<string, number>();
  for (const id of charSet) {
    const c = find(id);
    tm.set(id, seed.get(id) ?? seed.get(c) ?? 0);
  }
  return tm;
}

function compToTierMap(
  charSet: Set<string>,
  compTier: Map<string, number>,
  find: (x: string) => string,
): Map<string, number> {
  const tm = new Map<string, number>();
  for (const id of charSet) tm.set(id, compTier.get(find(id)) ?? 0);
  return tm;
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

export type EnforceResult =
  | { ok: true; assignments: TierAssignment[] }
  | { ok: false; reason: string };

/**
 * After a user drags a character to a new tier, cascade constraints so the
 * tier list stays consistent. Non-strict (>=) chains all move together to
 * the moved character's tier. Strict (>) constraints cascade between the
 * resulting equivalence classes.
 */
export function enforceAfterMove(
  currentAssignments: TierAssignment[],
  relationships: Relationship[],
  movedCharId: string,
  targetTier: string,
  tierIds: string[],
  charNames?: Map<string, string>,
): EnforceResult {
  const maxIdx = tierIds.length - 1;

  if (relationships.length === 0) {
    const result = currentAssignments.filter((a) => a.characterId !== movedCharId);
    const tierItems = result.filter((a) => a.tier === targetTier);
    result.push({ characterId: movedCharId, tier: targetTier, position: tierItems.length });
    return { ok: true, assignments: result };
  }

  const targetIdx = toIdx(targetTier, tierIds);
  const placedSet = new Set<string>([movedCharId]);
  for (const a of currentAssignments) placedSet.add(a.characterId);

  const seed = new Map<string, number>();
  for (const a of currentAssignments) seed.set(a.characterId, toIdx(a.tier, tierIds));
  seed.set(movedCharId, targetIdx);

  const fix = new Map<string, number>([[movedCharId, targetIdx]]);

  const rels: Constraint[] = relationships.map((r) => ({
    superiorId: r.superiorId,
    inferiorId: r.inferiorId,
    strict: r.strict ?? false,
  }));

  const movedName = charNames?.get(movedCharId) ?? movedCharId.slice(0, 8);
  log.info('enforce', `move ${movedName} → tier "${targetTier}" (idx ${targetIdx})`);

  const solved = solveTiers(placedSet, rels, seed, fix, maxIdx, charNames);
  if (solved.error) return { ok: false, reason: solved.error };

  return {
    ok: true,
    assignments: enforceWithinTierOrder(
      rebuildAssignments(solved.tierMap, currentAssignments, tierIds),
      relationships,
    ),
  };
}

/**
 * Place unranked characters that have relationships to placed ones, and
 * enforce all constraints across the list. Non-strict (>=) pulls unranked
 * chars straight to the partner's tier; strict (>) places one tier above
 * or below as appropriate. Best-effort: if constraints can't be fully
 * satisfied, logs a warning and returns the partial state rather than
 * failing.
 */
export function autoPlaceAndEnforce(
  currentAssignments: TierAssignment[],
  relationships: Relationship[],
  allCharacterIds: Set<string>,
  tierIds: string[],
): TierAssignment[] {
  const maxIdx = tierIds.length - 1;
  if (relationships.length === 0) return currentAssignments;

  // Every character that appears on either side of a relationship and is in
  // the active tier list belongs to the solver. Unranked chars without any
  // rel stay where they are (outside the solver's world).
  const inRels = new Set<string>();
  for (const rel of relationships) {
    if (allCharacterIds.has(rel.superiorId)) inRels.add(rel.superiorId);
    if (allCharacterIds.has(rel.inferiorId)) inRels.add(rel.inferiorId);
  }
  const charSet = new Set<string>();
  for (const a of currentAssignments) charSet.add(a.characterId);
  for (const id of inRels) charSet.add(id);

  const seed = new Map<string, number>();
  for (const a of currentAssignments) seed.set(a.characterId, toIdx(a.tier, tierIds));
  // Unranked chars: no seed → default to 0 (top). Cascade pushes down.

  const rels: Constraint[] = relationships.map((r) => ({
    superiorId: r.superiorId,
    inferiorId: r.inferiorId,
    strict: r.strict ?? false,
  }));

  const solved = solveTiers(charSet, rels, seed, new Map(), maxIdx, undefined, {
    clampOverflow: true,
  });
  if (solved.error) {
    log.warn('enforce', `autoPlaceAndEnforce: ${solved.error}`);
  }

  return enforceWithinTierOrder(
    rebuildAssignments(solved.tierMap, currentAssignments, tierIds),
    relationships,
  );
}

/**
 * Order characters within each tier. Non-strict (>=) edges between two
 * characters in the same tier say "superior before inferior." Under the
 * current model, bidirectional >= is rejected up front, so no SCCs can
 * form — plain Kahn's topological sort works directly, with position as
 * the tiebreaker for nodes that aren't related to each other.
 */
export function enforceWithinTierOrder(
  assignments: TierAssignment[],
  relationships: Relationship[],
): TierAssignment[] {
  if (relationships.length === 0) return assignments;

  const byTier = new Map<string, TierAssignment[]>();
  for (const a of assignments) {
    if (!byTier.has(a.tier)) byTier.set(a.tier, []);
    byTier.get(a.tier)!.push(a);
  }

  const result: TierAssignment[] = [];

  for (const [tier, tierAssigns] of byTier) {
    if (tierAssigns.length <= 1) {
      result.push(...tierAssigns);
      continue;
    }

    const charIds = [...new Set(tierAssigns.map((a) => a.characterId))];
    const posMap = new Map(tierAssigns.map((a) => [a.characterId, a.position]));

    const edges = new Map<string, string[]>();
    const inDeg = new Map<string, number>();
    for (const id of charIds) {
      edges.set(id, []);
      inDeg.set(id, 0);
    }
    for (const rel of relationships) {
      if (rel.strict) continue;
      if (!edges.has(rel.superiorId) || !edges.has(rel.inferiorId)) continue;
      edges.get(rel.superiorId)!.push(rel.inferiorId);
      inDeg.set(rel.inferiorId, inDeg.get(rel.inferiorId)! + 1);
    }

    // Kahn's — at each step, pick the ready node with the lowest current
    // position so non-constrained chars keep their drag-order.
    const ready: string[] = charIds
      .filter((id) => inDeg.get(id) === 0)
      .sort((a, b) => (posMap.get(a) ?? 0) - (posMap.get(b) ?? 0));

    const sorted: string[] = [];
    while (ready.length > 0) {
      const node = ready.shift()!;
      sorted.push(node);
      for (const neighbor of edges.get(node) ?? []) {
        const d = inDeg.get(neighbor)! - 1;
        inDeg.set(neighbor, d);
        if (d === 0) {
          const pos = posMap.get(neighbor) ?? 0;
          let i = 0;
          while (i < ready.length && (posMap.get(ready[i]) ?? 0) <= pos) i++;
          ready.splice(i, 0, neighbor);
        }
      }
    }

    // If any nodes remain unsorted, there's a stale cycle in the stored
    // data (shouldn't happen post-cycle-check). Append by position.
    if (sorted.length < charIds.length) {
      const missed = charIds
        .filter((id) => !sorted.includes(id))
        .sort((a, b) => (posMap.get(a) ?? 0) - (posMap.get(b) ?? 0));
      sorted.push(...missed);
    }

    sorted.forEach((id, pos) => {
      result.push({ characterId: id, tier, position: pos });
    });
  }

  return result;
}

export type CompactResult =
  | { ok: true; assignments: TierAssignment[]; movedCount: number }
  | { ok: false; reason: string };

/**
 * Move every placed character to the highest tier it can occupy without
 * breaking a relationship. Non-strict (>=) chains are pulled together into
 * one tier; strict (>) edges force tier gaps. Unranked characters are
 * untouched.
 *
 * If a chain is longer than the tier list can hold, the whole op is
 * refused with the offending chain named.
 */
export function compactUpward(
  currentAssignments: TierAssignment[],
  relationships: Relationship[],
  tierIds: string[],
  charNames?: Map<string, string>,
): CompactResult {
  const maxIdx = tierIds.length - 1;
  if (currentAssignments.length === 0) {
    return { ok: true, assignments: [], movedCount: 0 };
  }

  const placedSet = new Set(currentAssignments.map((a) => a.characterId));
  const relevantRels: Constraint[] = relationships
    .filter((r) => placedSet.has(r.superiorId) && placedSet.has(r.inferiorId))
    .map((r) => ({ superiorId: r.superiorId, inferiorId: r.inferiorId, strict: r.strict ?? false }));

  // Seed all at top (idx 0). Cascade pushes down only as needed.
  const seed = new Map<string, number>();
  for (const id of placedSet) seed.set(id, 0);

  // Compact enforces the written rels exactly — if they contain a real
  // contradiction (a `>` between two chars that a `>=` chain forces into
  // the same tier, or a chain too long for the list) we refuse to write
  // partial results and surface the issue so the user can fix it. The
  // inconsistency banner also lists rel-level contradictions so they're
  // visible without clicking Compact.
  const solved = solveTiers(placedSet, relevantRels, seed, new Map(), maxIdx, charNames);

  if (solved.error) {
    if (/no room at the bottom/i.test(solved.error)) {
      const overflowReason = buildChainOverflowReason(relevantRels, tierIds, charNames);
      if (overflowReason) return { ok: false, reason: overflowReason };
    }
    return { ok: false, reason: solved.error };
  }

  const rebuilt = rebuildAssignments(solved.tierMap, currentAssignments, tierIds);
  const ordered = enforceWithinTierOrder(rebuilt, relationships);

  const origTier = new Map(currentAssignments.map((a) => [a.characterId, a.tier]));
  let movedCount = 0;
  for (const a of ordered) {
    if (origTier.get(a.characterId) !== a.tier) movedCount++;
  }

  return { ok: true, assignments: ordered, movedCount };
}

function buildChainOverflowReason(
  rels: Constraint[],
  tierIds: string[],
  charNames?: Map<string, string>,
): string | null {
  const relationships: Relationship[] = rels.map((r, i) => ({
    id: `c-${i}`,
    tierListId: '',
    superiorId: r.superiorId,
    inferiorId: r.inferiorId,
    strict: r.strict,
    createdAt: 0,
  }));
  const needed = maxChainLength(relationships);
  if (needed <= tierIds.length) return null;
  const path = longestChainPath(relationships);
  if (path.length === 0) return null;
  const names = path.map((id) => charNames?.get(id) ?? id.slice(0, 8));
  const relByPair = new Map<string, boolean>();
  for (const r of rels) relByPair.set(`${r.superiorId}->${r.inferiorId}`, r.strict);
  let chainStr = names[0] ?? '';
  for (let i = 1; i < path.length; i++) {
    const op = relByPair.get(`${path[i - 1]}->${path[i]}`) ? '>' : '>=';
    chainStr += ` ${op} ${names[i]}`;
  }
  return `Chain needs ${needed} tiers but the list only has ${tierIds.length}: ${chainStr}`;
}

/**
 * Walk back from `endId` along predecessors whose (level + gap) exactly
 * produced the current level — this reconstructs the critical path that
 * forced this node to its depth. Returns IDs in top-to-bottom order.
 */
function traceForcingChain(
  endId: string,
  rels: Relationship[],
  tierMap: Map<string, number>,
): string[] {
  const rev = new Map<string, Array<{ id: string; strict: boolean }>>();
  for (const r of rels) {
    if (!rev.has(r.inferiorId)) rev.set(r.inferiorId, []);
    rev.get(r.inferiorId)!.push({ id: r.superiorId, strict: r.strict ?? false });
  }

  const path: string[] = [endId];
  const visited = new Set<string>([endId]);
  let cur = endId;
  while (true) {
    const curLevel = tierMap.get(cur)!;
    const preds = rev.get(cur) ?? [];
    let next: string | null = null;
    for (const p of preds) {
      const gap = p.strict ? 1 : 0;
      if ((tierMap.get(p.id) ?? 0) + gap === curLevel && !visited.has(p.id)) {
        next = p.id;
        break;
      }
    }
    if (!next) break;
    path.unshift(next);
    visited.add(next);
    cur = next;
  }
  return path;
}

/**
 * Longest-path length (in tier *levels*) through the relationship DAG.
 *
 * Returned value is the 1-based chain length: the minimum number of tiers
 * needed for the graph to be satisfiable. Under the new semantics `>=`
 * edges contribute 0 to level (same tier) and `>` contributes 1.
 */
export function maxChainLength(relationships: Relationship[]): number {
  if (relationships.length === 0) return 0;

  const nodes = new Set<string>();
  for (const r of relationships) {
    nodes.add(r.superiorId);
    nodes.add(r.inferiorId);
  }

  const level = new Map<string, number>();
  for (const n of nodes) level.set(n, 0);

  const MAX_ITER = Math.max(100, nodes.size * nodes.size + 1);
  let changed = true;
  let iter = 0;
  while (changed && iter < MAX_ITER) {
    changed = false;
    iter++;
    for (const r of relationships) {
      const si = level.get(r.superiorId)!;
      const ii = level.get(r.inferiorId)!;
      const gap = (r.strict ?? false) ? 1 : 0;
      if (si + gap > ii) {
        level.set(r.inferiorId, si + gap);
        changed = true;
      }
    }
  }

  let maxLevel = 0;
  for (const v of level.values()) if (v > maxLevel) maxLevel = v;
  return maxLevel + 1;
}

/** Like `maxChainLength`, but returns the actual chain path for display. */
export function longestChainPath(relationships: Relationship[]): string[] {
  if (relationships.length === 0) return [];

  const nodes = new Set<string>();
  for (const r of relationships) {
    nodes.add(r.superiorId);
    nodes.add(r.inferiorId);
  }

  const level = new Map<string, number>();
  for (const n of nodes) level.set(n, 0);

  const MAX_ITER = Math.max(100, nodes.size * nodes.size + 1);
  let changed = true;
  let iter = 0;
  while (changed && iter < MAX_ITER) {
    changed = false;
    iter++;
    for (const r of relationships) {
      const si = level.get(r.superiorId)!;
      const ii = level.get(r.inferiorId)!;
      const gap = (r.strict ?? false) ? 1 : 0;
      if (si + gap > ii) {
        level.set(r.inferiorId, si + gap);
        changed = true;
      }
    }
  }

  let deepest = '';
  let deepestLevel = -1;
  for (const [id, lvl] of level) {
    if (lvl > deepestLevel) {
      deepestLevel = lvl;
      deepest = id;
    }
  }
  if (!deepest) return [];
  return traceForcingChain(deepest, relationships, level);
}

function rebuildAssignments(
  tierMap: Map<string, number>,
  originalAssignments: TierAssignment[],
  tierIds: string[],
): TierAssignment[] {
  const origByChar = new Map<string, TierAssignment>();
  for (const a of originalAssignments) {
    origByChar.set(a.characterId, a);
  }

  const byTier = new Map<number, string[]>();
  for (const [charId, idx] of tierMap) {
    if (!byTier.has(idx)) byTier.set(idx, []);
    byTier.get(idx)!.push(charId);
  }

  const result: TierAssignment[] = [];

  for (const [idx, charIds] of byTier) {
    const tier = toTierId(idx, tierIds);
    const stayed: string[] = [];
    const moved: string[] = [];

    for (const id of charIds) {
      const orig = origByChar.get(id);
      if (orig && toIdx(orig.tier, tierIds) === idx) {
        stayed.push(id);
      } else {
        moved.push(id);
      }
    }

    stayed.sort((a, b) => {
      const ap = origByChar.get(a)?.position ?? 0;
      const bp = origByChar.get(b)?.position ?? 0;
      return ap - bp;
    });

    const ordered = [...stayed, ...moved];
    ordered.forEach((id, pos) => {
      result.push({ characterId: id, tier, position: pos });
    });
  }

  return result;
}
