import type { Relationship, TierAssignment } from '../types';
import { buildGraph, deriveLayeredRanking } from './graph';

function toIdx(tierId: string, tierIds: string[]): number {
  return tierIds.indexOf(tierId);
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
export function enforceAfterMove(
  currentAssignments: TierAssignment[],
  relationships: Relationship[],
  movedCharId: string,
  targetTier: string,
  tierIds: string[],
): TierAssignment[] {
  const maxIdx = tierIds.length - 1;

  if (relationships.length === 0) {
    const result = currentAssignments.filter((a) => a.characterId !== movedCharId);
    const tierItems = result.filter((a) => a.tier === targetTier);
    result.push({ characterId: movedCharId, tier: targetTier, position: tierItems.length });
    return result;
  }

  const tierMap = new Map<string, number>();
  for (const a of currentAssignments) {
    tierMap.set(a.characterId, toIdx(a.tier, tierIds));
  }
  tierMap.set(movedCharId, toIdx(targetTier, tierIds));

  const { fwd, rev } = buildGraphPair(relationships);

  // Phase 1: Push descendants down
  {
    const queue = [...(fwd.get(movedCharId)?.keys() ?? [])];
    while (queue.length > 0) {
      const node = queue.shift()!;
      const cur = tierMap.get(node);
      if (cur == null) continue;

      // Must be below all superiors (with gap for strict)
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

      // Must be above all inferiors (with gap for strict)
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

  return rebuildAssignments(tierMap, currentAssignments, tierIds);
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
    const remaining = new Set(unranked);
    let prevSize = remaining.size + 1;

    while (remaining.size > 0 && remaining.size < prevSize) {
      prevSize = remaining.size;
      for (const charId of [...remaining]) {
        let lo = 0;
        let hasConstraint = false;

        for (const [sup, edge] of rev.get(charId) ?? new Map()) {
          const si = tierMap.get(sup);
          if (si != null) {
            lo = Math.max(lo, si + (edge.strict ? 1 : 0));
            hasConstraint = true;
          }
        }
        for (const [inf] of fwd.get(charId) ?? new Map()) {
          const ii = tierMap.get(inf);
          if (ii != null) hasConstraint = true;
        }

        if (hasConstraint) {
          tierMap.set(charId, Math.min(lo, maxIdx));
          remaining.delete(charId);
        }
      }
    }

    // Characters with no placed neighbors — use graph layer derivation
    if (remaining.size > 0) {
      const graph = buildGraph(relationships);
      const layers = deriveLayeredRanking(graph);
      if (layers) {
        const numLayers = layers.size;
        const sortedLayers = [...layers.entries()].sort(([a], [b]) => a - b);
        for (const [layerIdx, charIds] of sortedLayers) {
          const tierIdx = Math.min(
            Math.floor((layerIdx / Math.max(numLayers, 1)) * numTiers),
            maxIdx,
          );
          for (const charId of charIds) {
            if (remaining.has(charId)) {
              tierMap.set(charId, tierIdx);
              remaining.delete(charId);
            }
          }
        }
      } else {
        // Fallback: put in middle tier
        const midIdx = Math.min(3, maxIdx);
        for (const charId of remaining) {
          tierMap.set(charId, midIdx);
        }
      }
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

  return rebuildAssignments(tierMap, currentAssignments, tierIds);
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
