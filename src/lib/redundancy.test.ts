import { describe, it, expect } from 'vitest';
import { findRedundantRelationships } from './redundancy';
import type { Relationship } from '../types';

function rel(id: string, superiorId: string, inferiorId: string, strict = true): Relationship {
  return {
    id,
    tierListId: 't',
    superiorId,
    inferiorId,
    strict,
    createdAt: 0,
  };
}

describe('findRedundantRelationships', () => {
  it('flags a direct edge when a longer chain already implies it', () => {
    // User example: A > F plus A > B, B = C, C > D, D >= E, E > F.
    // A > F is redundant: chain has 3 strict edges, A > F only needs 1.
    const rels: Relationship[] = [
      rel('direct', 'A', 'F', true),
      rel('ab', 'A', 'B', true),
      rel('bc', 'B', 'C', false),
      rel('cb', 'C', 'B', false), // mirror pair for B = C
      rel('cd', 'C', 'D', true),
      rel('de', 'D', 'E', false),
      rel('ef', 'E', 'F', true),
    ];
    const result = findRedundantRelationships(rels);
    expect(result.has('direct')).toBe(true);
    const info = result.get('direct')!;
    expect(info.path[0]).toBe('A');
    expect(info.path[info.path.length - 1]).toBe('F');
    // Should pass through B, C, D, E
    expect(info.path).toContain('B');
    expect(info.path).toContain('C');
    expect(info.path).toContain('D');
    expect(info.path).toContain('E');
  });

  it('does not flag a direct edge with no alternative path', () => {
    const rels = [rel('r', 'A', 'B', true)];
    expect(findRedundantRelationships(rels).size).toBe(0);
  });

  it('flags simple transitive A > B > C makes A > C redundant', () => {
    const rels = [
      rel('ab', 'A', 'B', true),
      rel('bc', 'B', 'C', true),
      rel('ac', 'A', 'C', true),
    ];
    const result = findRedundantRelationships(rels);
    expect(result.has('ac')).toBe(true);
    expect(result.has('ab')).toBe(false);
    expect(result.has('bc')).toBe(false);
  });

  it('does not flag A > C when chain only has non-strict (>=) edges', () => {
    // A >= B >= C. Alt path from A to C has 0 strict edges, but A > C needs 1.
    const rels = [
      rel('ab', 'A', 'B', false),
      rel('bc', 'B', 'C', false),
      rel('ac', 'A', 'C', true),
    ];
    expect(findRedundantRelationships(rels).has('ac')).toBe(false);
  });

  it('flags A >= C when any alt path exists, even all non-strict', () => {
    const rels = [
      rel('ab', 'A', 'B', false),
      rel('bc', 'B', 'C', false),
      rel('ac', 'A', 'C', false),
    ];
    expect(findRedundantRelationships(rels).has('ac')).toBe(true);
  });

  it('does not flag equality mirror pairs (A>=B, B>=A) as redundant of each other', () => {
    // Without any other rels, removing A>=B leaves no path A→B; same the other way.
    const rels = [
      rel('ab', 'A', 'B', false),
      rel('ba', 'B', 'A', false),
    ];
    expect(findRedundantRelationships(rels).size).toBe(0);
  });

  it('flags redundancy across multi-step chain with mixed strict/non-strict', () => {
    // A > B > C = D > E. Claim A > E is redundant (alt path has 3 strict).
    const rels: Relationship[] = [
      rel('direct', 'A', 'E', true),
      rel('ab', 'A', 'B', true),
      rel('bc', 'B', 'C', true),
      rel('cd', 'C', 'D', false),
      rel('dc', 'D', 'C', false),
      rel('de', 'D', 'E', true),
    ];
    const result = findRedundantRelationships(rels);
    expect(result.has('direct')).toBe(true);
  });

  it('returns an empty map for an empty graph', () => {
    expect(findRedundantRelationships([])).toEqual(new Map());
  });
});
