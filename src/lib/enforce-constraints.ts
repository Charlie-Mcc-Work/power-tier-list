import type { Relationship, TierAssignment } from '../types';

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
        tierMap.set(node, Math.min(reqMin, maxIdx));
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
        tierMap.set(node, Math.max(reqMax, 0));
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
  const numTiers = tierIds.length;

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
        for (const [inf, edge] of fwd.get(charId) ?? new Map()) {
          const ii = tierMap.get(inf);
          if (ii != null) {
            // We need to be at ii - gap or higher (lower index)
            // This is an upper bound, but we prefer the highest (lowest index)
            // so lo stays as the binding constraint from superiors
            hasPlacedNeighbor = true;
          }
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

  // Enforce all constraints (fixpoint: push inferiors down, respecting strict gaps)
  let changed = true;
  let iter = 0;
  while (changed && iter < 1000) {
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
