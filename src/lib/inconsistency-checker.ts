import type { TierAssignment, Relationship, Inconsistency, Character } from '../types';
import { TIER_RANKS } from '../types';
import { buildGraph, detectCycles } from './graph';

const tierIndex = new Map(TIER_RANKS.map((t, i) => [t, i]));

export function findInconsistencies(
  assignments: TierAssignment[],
  relationships: Relationship[],
  characters: Character[],
): Inconsistency[] {
  const inconsistencies: Inconsistency[] = [];
  const charMap = new Map(characters.map((c) => [c.id, c]));
  const assignmentMap = new Map(assignments.map((a) => [a.characterId, a]));

  // Check for placement inconsistencies: superior should be in same or higher tier than inferior
  for (const rel of relationships) {
    const supAssign = assignmentMap.get(rel.superiorId);
    const infAssign = assignmentMap.get(rel.inferiorId);

    if (!supAssign || !infAssign) continue; // one or both unranked, no inconsistency

    const supTierIdx = tierIndex.get(supAssign.tier)!;
    const infTierIdx = tierIndex.get(infAssign.tier)!;

    // Lower index = higher tier (S=0, A=1, etc.)
    if (supTierIdx > infTierIdx) {
      const supName = charMap.get(rel.superiorId)?.name ?? 'Unknown';
      const infName = charMap.get(rel.inferiorId)?.name ?? 'Unknown';
      inconsistencies.push({
        type: 'placement',
        message: `${supName} is ranked below ${infName} in tiers, but relationships say ${supName} > ${infName}`,
        characterIds: [rel.superiorId, rel.inferiorId],
        relationshipIds: [rel.id],
      });
    }
  }

  // Check for cycles
  const graph = buildGraph(relationships);
  const cycles = detectCycles(graph);
  for (const cycle of cycles) {
    const names = cycle.map((id) => charMap.get(id)?.name ?? 'Unknown');
    inconsistencies.push({
      type: 'cycle',
      message: `Circular ranking detected: ${names.join(' > ')} > ${names[0]}`,
      characterIds: cycle,
    });
  }

  return inconsistencies;
}
