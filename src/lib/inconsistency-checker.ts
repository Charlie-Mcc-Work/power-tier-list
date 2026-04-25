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

    // If either character is parked in a tier that no longer exists (renamed
    // or deleted), skip — silently defaulting to idx 0 would produce spurious
    // "ranked below" warnings.
    const supTierIdx = tierIndex.get(supAssign.tier);
    const infTierIdx = tierIndex.get(infAssign.tier);
    if (supTierIdx == null || infTierIdx == null) continue;

    const strict = rel.strict ?? false;
    const op = strict ? '>' : '>=';
    const supName = charMap.get(rel.superiorId)?.name ?? 'Unknown';
    const infName = charMap.get(rel.inferiorId)?.name ?? 'Unknown';

    if (strict) {
      // A > B: requires tier[A] + 1 <= tier[B].
      if (supTierIdx + 1 > infTierIdx) {
        inconsistencies.push({
          type: 'placement',
          message: `${supName} ${op} ${infName} but ${supName} is ${
            supTierIdx === infTierIdx ? 'in the same tier as' : 'ranked below'
          } ${infName}`,
          characterIds: [rel.superiorId, rel.inferiorId],
          relationshipIds: [rel.id],
        });
      }
    } else {
      // A >= B: requires tier[A] == tier[B] AND A before B in position.
      if (supTierIdx !== infTierIdx) {
        inconsistencies.push({
          type: 'placement',
          message: `${supName} ${op} ${infName} but they're in different tiers`,
          characterIds: [rel.superiorId, rel.inferiorId],
          relationshipIds: [rel.id],
        });
      } else if (supAssign.position > infAssign.position) {
        inconsistencies.push({
          type: 'placement',
          message: `${supName} ${op} ${infName} but ${supName} is positioned after ${infName} in the tier`,
          characterIds: [rel.superiorId, rel.inferiorId],
          relationshipIds: [rel.id],
        });
      }
    }
  }

  // Under the new model both `>` and `>=` enforce positional order — so ANY
  // cycle (strict, non-strict, or mixed) is unsatisfiable. Flag them all.
  // NOTE: detectCycles returns SCC members in reverse-DFS order, not cycle
  // traversal order, so the displayed path is approximate.
  const graph = buildGraph(relationships);
  const cycles = detectCycles(graph);

  for (const cycle of cycles) {
    const names = cycle.map((id) => charMap.get(id)?.name ?? 'Unknown');
    inconsistencies.push({
      type: 'cycle',
      message: `Circular ranking: ${names.join(' → ')} → ${names[0]}`,
      characterIds: cycle,
    });
  }

  // Rel-level contradiction: a strict `>` edge where the two endpoints are
  // already unified into the same tier by a chain of `>=` relationships.
  // The `>=` chain says "same tier," the `>` says "tier gap" — only the
  // user can resolve which one they meant. Surfaced here so Compact's
  // failure mode doesn't have to be the way you discover it.
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
  for (const rel of relationships) {
    if (!(rel.strict ?? false)) union(rel.superiorId, rel.inferiorId);
  }
  const reportedPairs = new Set<string>();
  for (const rel of relationships) {
    if (!(rel.strict ?? false)) continue;
    if (find(rel.superiorId) !== find(rel.inferiorId)) continue;
    const key = `${rel.superiorId}|${rel.inferiorId}`;
    if (reportedPairs.has(key)) continue;
    reportedPairs.add(key);
    const supName = charMap.get(rel.superiorId)?.name ?? 'Unknown';
    const infName = charMap.get(rel.inferiorId)?.name ?? 'Unknown';
    inconsistencies.push({
      type: 'cycle',
      message: `${supName} > ${infName} contradicts a >= chain that forces them into the same tier — remove one of the conflicting relationships`,
      characterIds: [rel.superiorId, rel.inferiorId],
      relationshipIds: [rel.id],
    });
  }

  return inconsistencies;
}
