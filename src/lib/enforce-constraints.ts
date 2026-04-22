import type { Relationship, TierAssignment } from '../types';
import { log } from './logger';

function toIdx(tierId: string, tierIds: string[]): number {
  const idx = tierIds.indexOf(tierId);
  return idx >= 0 ? idx : 0;
}
function toTierId(idx: number, tierIds: string[]): string {
  const maxIdx = tierIds.length - 1;
  return tierIds[Math.max(0, Math.min(idx, maxIdx))];
}

interface Edge {
  strict: boolean;
}

function buildGraphPair(relationships: Relationship[]) {
  const fwd = new Map<string, Map<string, Edge>>(); // superior -> {inferior -> edge}
  const rev = new Map<string, Map<string, Edge>>(); // inferior -> {superior -> edge}
  for (const rel of relationships) {
    const strict = rel.strict ?? false;
    if (!fwd.has(rel.superiorId)) fwd.set(rel.superiorId, new Map());
    fwd.get(rel.superiorId)!.set(rel.inferiorId, { strict });
    if (!rev.has(rel.inferiorId)) rev.set(rel.inferiorId, new Map());
    rev.get(rel.inferiorId)!.set(rel.superiorId, { strict });
  }
  return { fwd, rev };
}

/**
 * After a user moves a character to a new tier, cascade all relationship
 * constraints so the tier list stays consistent.
 *
 * For strict relationships (>), the inferior must be in a strictly lower tier.
 * For non-strict (>=), same tier is allowed.
 */
export type EnforceResult =
  | { ok: true; assignments: TierAssignment[] }
  | { ok: false; reason: string };

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

  const tierMap = new Map<string, number>();
  for (const a of currentAssignments) {
    tierMap.set(a.characterId, toIdx(a.tier, tierIds));
  }

  const movedName = charNames?.get(movedCharId) ?? movedCharId.slice(0, 8);
  log.info('enforce', `move ${movedName} → tier "${targetTier}" (idx ${toIdx(targetTier, tierIds)})`, {
    totalAssignments: currentAssignments.length,
    totalRelationships: relationships.length,
    numTiers: tierIds.length,
  });

  // Place at target — no pre-validation. Let the cascade handle everything.
  tierMap.set(movedCharId, toIdx(targetTier, tierIds));

  const { fwd, rev } = buildGraphPair(relationships);

  // Phase 1: Push descendants down
  {
    const queue = [...(fwd.get(movedCharId)?.keys() ?? [])];
    while (queue.length > 0) {
      const node = queue.shift()!;
      const cur = tierMap.get(node);
      if (cur == null) continue;

      let reqMin = 0;
      for (const [sup, edge] of rev.get(node) ?? new Map()) {
        const si = tierMap.get(sup);
        if (si != null) reqMin = Math.max(reqMin, si + (edge.strict ? 1 : 0));
      }

      if (cur < reqMin) {
        const newIdx = Math.min(reqMin, maxIdx);
        log.info('enforce', `push down: ${charNames?.get(node) ?? node.slice(0, 8)} tier ${cur} → ${newIdx}`);
        tierMap.set(node, newIdx);
        for (const child of fwd.get(node)?.keys() ?? []) queue.push(child);
      }
    }
  }

  // Phase 2: Push ancestors up
  {
    const queue = [...(rev.get(movedCharId)?.keys() ?? [])];
    while (queue.length > 0) {
      const node = queue.shift()!;
      const cur = tierMap.get(node);
      if (cur == null) continue;

      let reqMax = maxIdx;
      for (const [inf, edge] of fwd.get(node) ?? new Map()) {
        const ii = tierMap.get(inf);
        if (ii != null) reqMax = Math.min(reqMax, ii - (edge.strict ? 1 : 0));
      }

      if (cur > reqMax) {
        const newIdx = Math.max(reqMax, 0);
        log.info('enforce', `push up: ${charNames?.get(node) ?? node.slice(0, 8)} tier ${cur} → ${newIdx}`);
        tierMap.set(node, newIdx);
        for (const parent of rev.get(node)?.keys() ?? []) queue.push(parent);
      }
    }
  }

  // After cascading, verify ALL constraints are satisfied.
  // If any are violated (boundary clamp), the move is blocked.
  for (const rel of relationships) {
    const si = tierMap.get(rel.superiorId);
    const ii = tierMap.get(rel.inferiorId);
    if (si == null || ii == null) continue;
    const gap = (rel.strict ?? false) ? 1 : 0;
    if (si + gap > ii) {
      const supName = charNames?.get(rel.superiorId) ?? rel.superiorId;
      const infName = charNames?.get(rel.inferiorId) ?? rel.inferiorId;
      const op = rel.strict ? '>' : '>=';
      const boundary = si >= maxIdx ? 'bottom' : 'top';
      return {
        ok: false,
        reason: `${supName} ${op} ${infName} — no room at the ${boundary} of the list`,
      };
    }
  }

  return {
    ok: true,
    assignments: enforceWithinTierOrder(
      rebuildAssignments(tierMap, currentAssignments, tierIds),
      relationships,
    ),
  };
}

/**
 * Auto-place unranked characters that have relationships, then enforce
 * all constraints across the board.
 */
export function autoPlaceAndEnforce(
  currentAssignments: TierAssignment[],
  relationships: Relationship[],
  allCharacterIds: Set<string>,
  tierIds: string[],
): TierAssignment[] {
  const maxIdx = tierIds.length - 1;

  if (relationships.length === 0) return currentAssignments;

  const tierMap = new Map<string, number>();
  for (const a of currentAssignments) {
    tierMap.set(a.characterId, toIdx(a.tier, tierIds));
  }

  const { fwd, rev } = buildGraphPair(relationships);

  // Find characters in relationships but not yet placed
  const inRels = new Set<string>();
  for (const rel of relationships) {
    if (allCharacterIds.has(rel.superiorId)) inRels.add(rel.superiorId);
    if (allCharacterIds.has(rel.inferiorId)) inRels.add(rel.inferiorId);
  }

  const unranked = [...inRels].filter((id) => !tierMap.has(id));

  if (unranked.length > 0) {
    // Place each unranked character at the HIGHEST tier that respects
    // all existing constraints. Iterate until stable, since placing
    // one character may enable placing others.
    const remaining = new Set(unranked);
    let prevSize = remaining.size + 1;

    while (remaining.size > 0 && remaining.size < prevSize) {
      prevSize = remaining.size;
      for (const charId of [...remaining]) {
        // Highest valid = max of (each superior's tier + gap for strict)
        let lo = 0; // lowest allowed tier index (0 = highest tier)
        let hasPlacedNeighbor = false;

        for (const [sup, edge] of rev.get(charId) ?? new Map()) {
          const si = tierMap.get(sup);
          if (si != null) {
            lo = Math.max(lo, si + (edge.strict ? 1 : 0));
            hasPlacedNeighbor = true;
          }
        }

        // Also check inferiors: we must be ABOVE them
        for (const [inf] of fwd.get(charId) ?? new Map()) {
          if (tierMap.has(inf)) hasPlacedNeighbor = true;
        }

        if (hasPlacedNeighbor) {
          tierMap.set(charId, Math.min(lo, maxIdx));
          remaining.delete(charId);
        }
      }
    }

    // Characters with no placed neighbors at all — place at top tier (0).
    // The fixpoint enforcement below will push them down as needed.
    for (const charId of remaining) {
      tierMap.set(charId, 0);
    }
  }

  // Enforce all constraints (fixpoint: push inferiors down, respecting strict gaps).
  // Upper bound: each character can be pushed down at most tierIds.length times,
  // so tierMap.size * tierIds.length is a safe cap. If we ever exceed it something
  // has gone sideways (e.g., unsatisfiable relationships) — surface it instead of
  // silently returning.
  const MAX_ITER = Math.max(100, tierMap.size * tierIds.length);
  let changed = true;
  let iter = 0;
  while (changed && iter < MAX_ITER) {
    changed = false;
    iter++;
    for (const rel of relationships) {
      const si = tierMap.get(rel.superiorId);
      const ii = tierMap.get(rel.inferiorId);
      if (si == null || ii == null) continue;
      const minGap = (rel.strict ?? false) ? 1 : 0;
      if (si + minGap > ii) {
        tierMap.set(rel.inferiorId, Math.min(si + minGap, maxIdx));
        changed = true;
      }
    }
  }
  if (iter >= MAX_ITER && changed) {
    log.warn('enforce', `autoPlaceAndEnforce hit iteration cap (${MAX_ITER}) — constraints may be unsatisfiable`, {
      nodes: tierMap.size,
      relationships: relationships.length,
    });
  }

  return enforceWithinTierOrder(
    rebuildAssignments(tierMap, currentAssignments, tierIds),
    relationships,
  );
}

/**
 * Enforce within-tier ordering based on non-strict (>=) relationships.
 * If A >= B and both are in the same tier, A must be positioned before B.
 * Exported so the drag handler can apply it to within-tier reorders.
 */
export function enforceWithinTierOrder(
  assignments: TierAssignment[],
  relationships: Relationship[],
): TierAssignment[] {
  if (relationships.length === 0) return assignments;

  // Group assignments by tier
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

    const charIds = new Set(tierAssigns.map((a) => a.characterId));
    const posMap = new Map(tierAssigns.map((a) => [a.characterId, a.position]));

    // Build subgraph: non-strict edges between characters in this tier
    const edges = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    for (const id of charIds) {
      edges.set(id, []);
      inDegree.set(id, 0);
    }

    for (const rel of relationships) {
      if (rel.strict) continue; // strict means different tiers, no within-tier effect
      if (charIds.has(rel.superiorId) && charIds.has(rel.inferiorId)) {
        edges.get(rel.superiorId)!.push(rel.inferiorId);
        inDegree.set(rel.inferiorId, (inDegree.get(rel.inferiorId) ?? 0) + 1);
      }
    }

    // Topological sort (Kahn's) with existing position as tiebreaker
    const sorted: string[] = [];
    const queue = [...charIds]
      .filter((id) => (inDegree.get(id) ?? 0) === 0)
      .sort((a, b) => (posMap.get(a) ?? 0) - (posMap.get(b) ?? 0));

    while (queue.length > 0) {
      const node = queue.shift()!;
      sorted.push(node);
      for (const neighbor of edges.get(node) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) {
          // Insert in position-sorted order for stable tiebreaking
          const nPos = posMap.get(neighbor) ?? 0;
          let i = 0;
          while (i < queue.length && (posMap.get(queue[i]) ?? 0) <= nPos) i++;
          queue.splice(i, 0, neighbor);
        }
      }
    }

    // Any remaining characters (from equality cycles like A=B) keep existing order
    const inSorted = new Set(sorted);
    const remaining = [...charIds]
      .filter((id) => !inSorted.has(id))
      .sort((a, b) => (posMap.get(a) ?? 0) - (posMap.get(b) ?? 0));
    sorted.push(...remaining);

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
 * Move every *placed* character to the highest tier it can occupy without
 * breaking any relationship. Unranked characters are left alone.
 *
 * A placed character with no relationships to other placed characters
 * floats all the way to the top tier (level 0). Relationships involving
 * an unranked endpoint are ignored — those characters haven't been
 * addressed by the user yet.
 *
 * If any chain of strict (>) edges through placed characters is longer
 * than the tier list, the whole operation is refused with an explanation
 * that names the offending chain.
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

  const placedIds = new Set(currentAssignments.map((a) => a.characterId));
  const relevantRels = relationships.filter(
    (r) => placedIds.has(r.superiorId) && placedIds.has(r.inferiorId),
  );

  // Seed every placed character at the top tier.
  const tierMap = new Map<string, number>();
  for (const a of currentAssignments) tierMap.set(a.characterId, 0);

  // Push-down fixpoint: each edge demands inferior >= superior + gap.
  // Non-strict (>=) cycles don't push (gap 0). Strict cycles are impossible
  // here because the cycle check rejects them at relationship-add time.
  const MAX_ITER = Math.max(100, placedIds.size * tierIds.length + 1);
  let changed = true;
  let iter = 0;
  while (changed && iter < MAX_ITER) {
    changed = false;
    iter++;
    for (const rel of relevantRels) {
      const si = tierMap.get(rel.superiorId)!;
      const ii = tierMap.get(rel.inferiorId)!;
      const gap = (rel.strict ?? false) ? 1 : 0;
      if (si + gap > ii) {
        tierMap.set(rel.inferiorId, si + gap);
        changed = true;
      }
    }
  }

  // If anyone needs a tier beyond the bottom, explain via the chain that forced it.
  for (const [charId, idx] of tierMap) {
    if (idx > maxIdx) {
      const chain = traceForcingChain(charId, relevantRels, tierMap);
      const names = chain.map((id) => charNames?.get(id) ?? id.slice(0, 8));
      const ops: string[] = [];
      for (let i = 0; i < chain.length - 1; i++) {
        const rel = relevantRels.find(
          (r) => r.superiorId === chain[i] && r.inferiorId === chain[i + 1],
        );
        ops.push(rel?.strict ? '>' : '>=');
      }
      let chainStr = names[0] ?? '';
      for (let i = 1; i < names.length; i++) chainStr += ` ${ops[i - 1]} ${names[i]}`;
      return {
        ok: false,
        reason: `Chain needs ${idx + 1} tiers but the list only has ${tierIds.length}: ${chainStr}`,
      };
    }
  }

  const rebuilt = rebuildAssignments(tierMap, currentAssignments, tierIds);
  const ordered = enforceWithinTierOrder(rebuilt, relationships);

  const origTier = new Map(currentAssignments.map((a) => [a.characterId, a.tier]));
  let movedCount = 0;
  for (const a of ordered) {
    if (origTier.get(a.characterId) !== a.tier) movedCount++;
  }

  return { ok: true, assignments: ordered, movedCount };
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
 * Returned value is the 1-based chain length: the minimum number of
 * tiers needed for the graph to be satisfiable. A single node = 1;
 * A > B = 2; A >= B = 1 (no strict gap).
 *
 * Non-strict cycles (equality groups) collapse to a single level.
 * Callers should have already rejected unsatisfiable (strict) cycles.
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

/**
 * Like `maxChainLength`, but reports which chain hit the maximum so we
 * can tell the user *why* their addition was rejected.
 */
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
