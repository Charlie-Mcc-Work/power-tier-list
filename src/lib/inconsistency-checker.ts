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

  for (const rel of relationships) {
    const supAssign = assignmentMap.get(rel.superiorId);
    const infAssign = assignmentMap.get(rel.inferiorId);

    if (!supAssign || !infAssign) continue;

    const supTierIdx = tierIndex.get(supAssign.tier)!;
    const infTierIdx = tierIndex.get(infAssign.tier)!;
    const minGap = (rel.strict ?? false) ? 1 : 0;
    const op = rel.strict ? '>' : '>=';

    // supTierIdx + minGap should be <= infTierIdx
    if (supTierIdx + minGap > infTierIdx) {
      const supName = charMap.get(rel.superiorId)?.name ?? 'Unknown';
      const infName = charMap.get(rel.inferiorId)?.name ?? 'Unknown';
      inconsistencies.push({
        type: 'placement',
        message: `${supName} ${op} ${infName} but ${supName} is ${
          supTierIdx === infTierIdx ? 'in the same tier as' : 'ranked below'
        } ${infName}`,
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
