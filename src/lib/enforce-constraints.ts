import type { Relationship, TierAssignment, TierRank } from '../types';
import { TIER_RANKS } from '../types';
import { buildGraph, deriveLayeredRanking } from './graph';

const TIER_TO_IDX = new Map(TIER_RANKS.map((t, i) => [t, i]));
const MAX_IDX = TIER_RANKS.length - 1;

function toIdx(tier: TierRank): number {
  return TIER_TO_IDX.get(tier)!;
}
function toTier(idx: number): TierRank {
  return TIER_RANKS[Math.max(0, Math.min(idx, MAX_IDX))];
}

function buildGraphPair(relationships: Relationship[]) {
  const fwd = new Map<string, Set<string>>(); // superior -> inferiors
  const rev = new Map<string, Set<string>>(); // inferior -> superiors
  for (const rel of relationships) {
    if (!fwd.has(rel.superiorId)) fwd.set(rel.superiorId, new Set());
    fwd.get(rel.superiorId)!.add(rel.inferiorId);
    if (!rev.has(rel.inferiorId)) rev.set(rel.inferiorId, new Set());
    rev.get(rel.inferiorId)!.add(rel.superiorId);
  }
  return { fwd, rev };
}

/**
 * After a user moves a character to a new tier, cascade all relationship
 * constraints so the tier list stays consistent.
 *
 * Algorithm:
 * 1. Anchor the moved character at the target tier.
 * 2. BFS down through inferiors: push any that are above their superiors down.
 * 3. BFS up through superiors: push any that are below their inferiors up.
 */
export function enforceAfterMove(
  currentAssignments: TierAssignment[],
  relationships: Relationship[],
  movedCharId: string,
  targetTier: TierRank,
): TierAssignment[] {
  if (relationships.length === 0) {
    // No constraints — simple move
    const result = currentAssignments.filter((a) => a.characterId !== movedCharId);
    const tierItems = result.filter((a) => a.tier === targetTier);
    result.push({ characterId: movedCharId, tier: targetTier, position: tierItems.length });
    return result;
  }

  const tierMap = new Map<string, number>();
  for (const a of currentAssignments) {
    tierMap.set(a.characterId, toIdx(a.tier));
  }
  tierMap.set(movedCharId, toIdx(targetTier));

  const { fwd, rev } = buildGraphPair(relationships);

  // Phase 1: Push descendants down (handles when anchor moved down)
  {
    const queue = [...(fwd.get(movedCharId) ?? [])];
    while (queue.length > 0) {
      const node = queue.shift()!;
      const cur = tierMap.get(node);
      if (cur == null) continue; // unranked — skip

      // Must be at or below ALL superiors
      let reqMin = 0;
      for (const sup of rev.get(node) ?? []) {
        const si = tierMap.get(sup);
        if (si != null) reqMin = Math.max(reqMin, si);
      }

      if (cur < reqMin) {
        tierMap.set(node, Math.min(reqMin, MAX_IDX));
        for (const child of fwd.get(node) ?? []) queue.push(child);
      }
    }
  }

  // Phase 2: Push ancestors up (handles when anchor moved up)
  {
    const queue = [...(rev.get(movedCharId) ?? [])];
    while (queue.length > 0) {
      const node = queue.shift()!;
      const cur = tierMap.get(node);
      if (cur == null) continue;

      // Must be at or above ALL inferiors
      let reqMax = MAX_IDX;
      for (const inf of fwd.get(node) ?? []) {
        const ii = tierMap.get(inf);
        if (ii != null) reqMax = Math.min(reqMax, ii);
      }

      if (cur > reqMax) {
        tierMap.set(node, Math.max(reqMax, 0));
        for (const parent of rev.get(node) ?? []) queue.push(parent);
      }
    }
  }

  return rebuildAssignments(tierMap, currentAssignments);
}

/**
 * Auto-place unranked characters that have relationships, then enforce
 * all constraints across the board. Called after adding relationships.
 */
export function autoPlaceAndEnforce(
  currentAssignments: TierAssignment[],
  relationships: Relationship[],
  allCharacterIds: Set<string>,
): TierAssignment[] {
  if (relationships.length === 0) return currentAssignments;

  const tierMap = new Map<string, number>();
  for (const a of currentAssignments) {
    tierMap.set(a.characterId, toIdx(a.tier));
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
    // Try to place each based on already-placed neighbors
    const remaining = new Set(unranked);
    let prevSize = remaining.size + 1;

    while (remaining.size > 0 && remaining.size < prevSize) {
      prevSize = remaining.size;
      for (const charId of [...remaining]) {
        let lo = 0;
        let hasConstraint = false;

        for (const sup of rev.get(charId) ?? []) {
          const si = tierMap.get(sup);
          if (si != null) {
            lo = Math.max(lo, si);
            hasConstraint = true;
          }
        }
        for (const inf of fwd.get(charId) ?? []) {
          const ii = tierMap.get(inf);
          if (ii != null) hasConstraint = true;
        }

        if (hasConstraint) {
          tierMap.set(charId, lo);
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
        const numTiers = TIER_RANKS.length;
        const sortedLayers = [...layers.entries()].sort(([a], [b]) => a - b);
        for (const [layerIdx, charIds] of sortedLayers) {
          // Spread layers proportionally across tiers
          const tierIdx = Math.min(
            Math.floor((layerIdx / Math.max(numLayers, 1)) * numTiers),
            MAX_IDX,
          );
          for (const charId of charIds) {
            if (remaining.has(charId)) {
              tierMap.set(charId, tierIdx);
              remaining.delete(charId);
            }
          }
        }
      } else {
        // Cycles present — place at C tier
        for (const charId of remaining) {
          tierMap.set(charId, 3);
        }
      }
    }
  }

  // Enforce all constraints (fixpoint: push inferiors down)
  let changed = true;
  let iter = 0;
  while (changed && iter < 1000) {
    changed = false;
    iter++;
    for (const rel of relationships) {
      const si = tierMap.get(rel.superiorId);
      const ii = tierMap.get(rel.inferiorId);
      if (si == null || ii == null) continue;
      if (si > ii) {
        tierMap.set(rel.inferiorId, Math.min(si, MAX_IDX));
        changed = true;
      }
    }
  }

  return rebuildAssignments(tierMap, currentAssignments);
}

/**
 * Rebuild TierAssignment[] from the tier map, preserving existing
 * within-tier ordering for characters that didn't change tier.
 */
function rebuildAssignments(
  tierMap: Map<string, number>,
  originalAssignments: TierAssignment[],
): TierAssignment[] {
  const origByChar = new Map<string, TierAssignment>();
  for (const a of originalAssignments) {
    origByChar.set(a.characterId, a);
  }

  // Group by tier index
  const byTier = new Map<number, string[]>();
  for (const [charId, idx] of tierMap) {
    if (!byTier.has(idx)) byTier.set(idx, []);
    byTier.get(idx)!.push(charId);
  }

  const result: TierAssignment[] = [];

  for (const [idx, charIds] of byTier) {
    const tier = toTier(idx);

    // Characters that were already in this tier vs newly moved here
    const stayed: string[] = [];
    const moved: string[] = [];

    for (const id of charIds) {
      const orig = origByChar.get(id);
      if (orig && toIdx(orig.tier) === idx) {
        stayed.push(id);
      } else {
        moved.push(id);
      }
    }

    // Preserve existing positions for characters that stayed
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
