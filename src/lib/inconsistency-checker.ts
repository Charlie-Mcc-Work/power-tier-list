import type { TierAssignment, Relationship, Inconsistency, Character } from '../types';
import { buildGraph, detectCycles } from './graph';

export function findInconsistencies(
  assignments: TierAssignment[],
  relationships: Relationship[],
  characters: Character[],
  tierIds: string[],
): Inconsistency[] {
  const tierIndex = new Map(tierIds.map((t, i) => [t, i]));
  const inconsistencies: Inconsistency[] = [];
  const charMap = new Map(characters.map((c) => [c.id, c]));
  const assignmentMap = new Map(assignments.map((a) => [a.characterId, a]));

  for (const rel of relationships) {
    const supAssign = assignmentMap.get(rel.superiorId);
    const infAssign = assignmentMap.get(rel.inferiorId);

    if (!supAssign || !infAssign) continue;

    const supTierIdx = tierIndex.get(supAssign.tier) ?? 0;
    const infTierIdx = tierIndex.get(infAssign.tier) ?? 0;
    const minGap = (rel.strict ?? false) ? 1 : 0;
    const op = rel.strict ? '>' : '>=';

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

  // Only flag cycles that contain at least one strict (>) edge.
  // Non-strict-only cycles (all >=) are satisfiable — they mean "same tier."
  const graph = buildGraph(relationships);
  const cycles = detectCycles(graph);
  const edgeStrict = new Map<string, boolean>();
  for (const rel of relationships) {
    edgeStrict.set(`${rel.superiorId}->${rel.inferiorId}`, rel.strict ?? false);
  }

  for (const cycle of cycles) {
    const hasStrictEdge = cycle.some((id, i) => {
      const next = cycle[(i + 1) % cycle.length];
      return edgeStrict.get(`${id}->${next}`) === true;
    });

    if (hasStrictEdge) {
      const names = cycle.map((id) => charMap.get(id)?.name ?? 'Unknown');
      inconsistencies.push({
        type: 'cycle',
        message: `Circular ranking: ${names.join(' > ')} > ${names[0]}`,
        characterIds: cycle,
      });
    }
  }

  return inconsistencies;
}
