import { describe, it, expect } from 'vitest';
import { findContradictions } from './contradictions';
import type { Relationship } from '../types';

function rel(id: string, superiorId: string, inferiorId: string, strict = true): Relationship {
  return { id, tierListId: 't', superiorId, inferiorId, strict, createdAt: 0 };
}

describe('findContradictions', () => {
  it('returns empty on a DAG with no contradictions', () => {
    const rels = [rel('1', 'A', 'B'), rel('2', 'B', 'C'), rel('3', 'A', 'C')];
    expect(findContradictions(rels)).toEqual([]);
  });

  it('flags a bidirectional non-strict pair (former equality)', () => {
    const rels = [rel('1', 'A', 'B', false), rel('2', 'B', 'A', false)];
    const groups = findContradictions(rels);
    expect(groups).toHaveLength(1);
    expect(groups[0].characterIds.sort()).toEqual(['A', 'B']);
    expect([...groups[0].relationshipIds].sort()).toEqual(['1', '2']);
  });

  it('flags a strict edge sitting inside a >= chain', () => {
    // A >= B >= C — A and C are forced into the same tier via B. A > C then
    // asserts a tier gap between them, which is impossible.
    const rels = [
      rel('1', 'A', 'B', false),
      rel('2', 'B', 'C', false),
      rel('3', 'A', 'C', true),
    ];
    const groups = findContradictions(rels);
    expect(groups).toHaveLength(1);
    expect(groups[0].characterIds.sort()).toEqual(['A', 'B', 'C']);
    expect(groups[0].relationshipIds.size).toBe(3);
  });

  it('keeps separate cycles in separate groups when they share no characters', () => {
    const rels = [
      rel('1', 'A', 'B', false),
      rel('2', 'B', 'A', false),
      rel('3', 'X', 'Y', false),
      rel('4', 'Y', 'X', false),
    ];
    const groups = findContradictions(rels);
    expect(groups).toHaveLength(2);
  });

  it('merges separate contradictions that share a character', () => {
    // Two 2-cycles sharing node B. Should fold into one group.
    const rels = [
      rel('1', 'A', 'B', false),
      rel('2', 'B', 'A', false),
      rel('3', 'B', 'C', false),
      rel('4', 'C', 'B', false),
    ];
    const groups = findContradictions(rels);
    expect(groups).toHaveLength(1);
    expect(groups[0].characterIds.sort()).toEqual(['A', 'B', 'C']);
    expect(groups[0].relationshipIds.size).toBe(4);
  });

  it('describes strict-only cycle vs non-strict cycle differently', () => {
    const strictCycle = [
      rel('1', 'A', 'B', true),
      rel('2', 'B', 'A', true),
    ];
    const nonStrictCycle = [
      rel('1', 'A', 'B', false),
      rel('2', 'B', 'A', false),
    ];
    expect(findContradictions(strictCycle)[0].summary).toMatch(/strictly above/i);
    expect(findContradictions(nonStrictCycle)[0].summary).toMatch(/form a cycle/i);
  });

  it('only includes rels on the >= path between the strict endpoints, not unrelated branches', () => {
    // The `>` edge is A > D. The chain A >= B >= C >= D forces them into
    // the same tier — that's the conflict. D >= E and B >= F are *also* in
    // the same `>=` class but neither lies on any path between A and D.
    // They shouldn't be lumped into the contradiction group; deleting
    // them wouldn't help resolve it.
    const rels = [
      rel('1', 'A', 'B', false),
      rel('2', 'B', 'C', false),
      rel('3', 'C', 'D', false),
      rel('4', 'D', 'E', false), // off-path branch
      rel('5', 'B', 'F', false), // off-path branch
      rel('6', 'A', 'D', true),  // the conflicting strict
    ];
    const groups = findContradictions(rels);
    expect(groups).toHaveLength(1);
    const group = groups[0];
    // Strict edge + the 3 `>=` edges along A→B→C→D = 4 rels.
    expect(group.relationshipIds.size).toBe(4);
    expect(group.relationshipIds.has('6')).toBe(true);
    expect(group.relationshipIds.has('1')).toBe(true);
    expect(group.relationshipIds.has('2')).toBe(true);
    expect(group.relationshipIds.has('3')).toBe(true);
    expect(group.relationshipIds.has('4')).toBe(false);
    expect(group.relationshipIds.has('5')).toBe(false);
    expect(group.characterIds.sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(group.characterIds).not.toContain('E');
    expect(group.characterIds).not.toContain('F');
  });

  it('flags a class-level cycle: two >= groups with strict edges in opposite directions', () => {
    // {A1, A2} unified by A1 >= A2.
    // {B1, B2} unified by B1 >= B2.
    // A1 > B1 says ClassA above ClassB.
    // B2 > A2 says ClassB above ClassA.
    // No graph SCC, no strict-within-class, but unsatisfiable: tier(A1) <
    // tier(B1) = tier(B2) < tier(A2) = tier(A1).
    const rels = [
      rel('1', 'A1', 'A2', false),
      rel('2', 'B1', 'B2', false),
      rel('3', 'A1', 'B1', true),
      rel('4', 'B2', 'A2', true),
    ];
    const groups = findContradictions(rels);
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group.relationshipIds.size).toBe(4);
    expect(group.characterIds.sort()).toEqual(['A1', 'A2', 'B1', 'B2']);
  });

  it('does not flag the Maki/Naoya case (clean `>=`, no cycle, no strict-in-class)', () => {
    // Just `Maki >= Naoya` — under the new model this is perfectly
    // satisfiable (same tier, Maki first). Not a contradiction, only a
    // potential *placement* inconsistency if the stored tiers are stale.
    const rels = [rel('1', 'Maki', 'Naoya', false)];
    expect(findContradictions(rels)).toEqual([]);
  });
});
