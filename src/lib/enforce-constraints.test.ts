import { describe, it, expect } from 'vitest';
import {
  enforceAfterMove,
  autoPlaceAndEnforce,
  enforceWithinTierOrder,
  compactUpward,
  maxChainLength,
} from './enforce-constraints';
import type { Relationship, TierAssignment } from '../types';

const TIERS = ['S', 'A', 'B', 'C', 'D', 'F'];

function rel(superiorId: string, inferiorId: string, strict = true): Relationship {
  return {
    id: `${superiorId}->${inferiorId}`,
    tierListId: 't',
    superiorId,
    inferiorId,
    strict,
    evidenceIds: [],
    createdAt: 0,
  };
}

function at(charId: string, tier: string, position = 0): TierAssignment {
  return { characterId: charId, tier, position };
}

function tierOf(result: TierAssignment[], charId: string): string | undefined {
  return result.find((a) => a.characterId === charId)?.tier;
}

describe('enforceAfterMove — no relationships', () => {
  it('places the character at the target tier with no cascades', () => {
    const result = enforceAfterMove([], [], 'A', 'S', TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assignments).toEqual([at('A', 'S', 0)]);
    }
  });

  it('preserves other characters when moving one', () => {
    const initial = [at('A', 'B'), at('X', 'C', 0)];
    const result = enforceAfterMove(initial, [], 'A', 'S', TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'A')).toBe('S');
      expect(tierOf(result.assignments, 'X')).toBe('C');
    }
  });
});

describe('enforceAfterMove — strict (>) cascading', () => {
  it('pushes inferior down when superior moves above it', () => {
    // A > B currently A:S, B:A. Now move A still in S — fine.
    // Test: A > B, A in B-tier, B in S-tier. Move A to S → B must go below S (strict).
    const initial = [at('A', 'B'), at('B', 'S')];
    const rels = [rel('A', 'B', true)];
    const result = enforceAfterMove(initial, rels, 'A', 'S', TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'A')).toBe('S');
      // B was at S (above A) → must be pushed strictly below S
      expect(tierOf(result.assignments, 'B')).toBe('A');
    }
  });

  it('cascades through a chain', () => {
    // Start from a consistent state: A:S, B:A, C:B  (A>B>C, all strict, all spaced).
    // Move A down to B → B must drop to C, C must drop to D.
    const initial = [at('A', 'S'), at('B', 'A'), at('C', 'B')];
    const rels = [rel('A', 'B'), rel('B', 'C')];
    const result = enforceAfterMove(initial, rels, 'A', 'B', TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'A')).toBe('B');
      expect(tierOf(result.assignments, 'B')).toBe('C');
      expect(tierOf(result.assignments, 'C')).toBe('D');
    }
  });

  it('pushes superior up when inferior moves above it', () => {
    // A > B, A:B-tier, B:F-tier. Move B to S — A must be above S (strict). No room → blocked.
    const initial = [at('A', 'B'), at('B', 'F')];
    const rels = [rel('A', 'B')];
    const result = enforceAfterMove(initial, rels, 'B', 'S', TIERS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no room/i);
    }
  });

  it('blocks when inferior gets pushed past the bottom', () => {
    // 6 tiers. A > B > C > D > E > F > G — chain of 7.
    // Move A to S — needs A:S, B:A, C:B, D:C, E:D, F:F, G:?? (off the bottom).
    const chain = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const initial = chain.map((c) => at(c, 'F'));
    const rels: Relationship[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      rels.push(rel(chain[i], chain[i + 1]));
    }
    const result = enforceAfterMove(initial, rels, 'A', 'S', TIERS);
    expect(result.ok).toBe(false);
  });
});

describe('enforceAfterMove — non-strict (>=) cascading', () => {
  it('allows superior and inferior in the same tier', () => {
    // A >= B, both initially in F. Move A to S → B must be at or below S — already is.
    const initial = [at('A', 'F'), at('B', 'F')];
    const rels = [rel('A', 'B', false)];
    const result = enforceAfterMove(initial, rels, 'A', 'S', TIERS);
    expect(result.ok).toBe(true);
  });

  it('pushes B to same tier as A (not below) for non-strict', () => {
    // A >= B, A:F, B was above A at S. Move A to S → B must be ≤ S; can stay at S.
    const initial = [at('A', 'F'), at('B', 'S')];
    const rels = [rel('A', 'B', false)];
    const result = enforceAfterMove(initial, rels, 'A', 'B', TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Expect B to be at B-tier (same as A) or lower — the cascade should bring it down to B.
      const bTier = tierOf(result.assignments, 'B');
      const tierIdx = (t: string) => TIERS.indexOf(t);
      expect(tierIdx(bTier!)).toBeGreaterThanOrEqual(tierIdx('B'));
    }
  });
});

describe('enforceAfterMove — within-tier ordering', () => {
  it('orders A before B in the same tier when A >= B', () => {
    const initial = [at('A', 'B', 1), at('B', 'B', 0)];
    const rels = [rel('A', 'B', false)];
    const result = enforceAfterMove(initial, rels, 'A', 'B', TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const sortedB = result.assignments
        .filter((a) => a.tier === 'B')
        .sort((x, y) => x.position - y.position)
        .map((a) => a.characterId);
      expect(sortedB).toEqual(['A', 'B']);
    }
  });

  it('does not reorder strict relationships within a tier (they should not coexist)', () => {
    // A > B, both forced into B-tier somehow — strict order doesn't reorder same-tier.
    // But strict should have prevented this; we test the within-tier function isolation.
    const result = enforceWithinTierOrder(
      [at('A', 'B', 1), at('B', 'B', 0)],
      [rel('A', 'B', true)], // strict — no within-tier effect
    );
    const sortedB = result.filter((a) => a.tier === 'B').sort((x, y) => x.position - y.position);
    // Original positions preserved (B at 0, A at 1)
    expect(sortedB.map((a) => a.characterId)).toEqual(['B', 'A']);
  });
});

describe('autoPlaceAndEnforce', () => {
  it('returns input unchanged with no relationships', () => {
    const initial = [at('A', 'B')];
    expect(autoPlaceAndEnforce(initial, [], new Set(['A']), TIERS)).toEqual(initial);
  });

  it('places an unranked character based on a known superior', () => {
    // A is ranked S, B is unranked, A > B.
    // B should auto-place at A-tier (one below S) since strict.
    const initial = [at('A', 'S')];
    const rels = [rel('A', 'B', true)];
    const result = autoPlaceAndEnforce(initial, rels, new Set(['A', 'B']), TIERS);
    expect(tierOf(result, 'B')).toBe('A');
  });

  it('places non-strict inferior in same tier as superior', () => {
    const initial = [at('A', 'S')];
    const rels = [rel('A', 'B', false)];
    const result = autoPlaceAndEnforce(initial, rels, new Set(['A', 'B']), TIERS);
    expect(tierOf(result, 'B')).toBe('S');
  });

  it('cascades placements through a chain', () => {
    // A:S, A > B > C > D, none of B/C/D placed.
    const initial = [at('A', 'S')];
    const rels = [rel('A', 'B'), rel('B', 'C'), rel('C', 'D')];
    const result = autoPlaceAndEnforce(initial, rels, new Set(['A', 'B', 'C', 'D']), TIERS);
    expect(tierOf(result, 'B')).toBe('A');
    expect(tierOf(result, 'C')).toBe('B');
    expect(tierOf(result, 'D')).toBe('C');
  });

  it('does not move an existing assignment if all constraints already satisfied', () => {
    const initial = [at('A', 'S'), at('B', 'C')];
    const rels = [rel('A', 'B', true)]; // A > B; A at S, B at C — fine.
    const result = autoPlaceAndEnforce(initial, rels, new Set(['A', 'B']), TIERS);
    expect(tierOf(result, 'A')).toBe('S');
    expect(tierOf(result, 'B')).toBe('C');
  });

  it('clamps to bottom tier when overflow would occur', () => {
    // 7-deep chain placed top-down should clamp at bottom for the deepest node.
    const chain = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const initial = [at('A', 'S')];
    const rels: Relationship[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      rels.push(rel(chain[i], chain[i + 1]));
    }
    const result = autoPlaceAndEnforce(initial, rels, new Set(chain), TIERS);
    // G should be clamped to F (bottom).
    expect(tierOf(result, 'G')).toBe('F');
  });
});

describe('enforceAfterMove — cross-dependency stress tests', () => {
  it('diamond graph: A>B, A>C, B>D, C>D — move A cascades to D through both branches', () => {
    // Consistent: A:S, B:A, C:A, D:B. Move A to B → B&C to C, D to D.
    const initial = [at('A', 'S'), at('B', 'A'), at('C', 'A'), at('D', 'B')];
    const rels = [rel('A', 'B'), rel('A', 'C'), rel('B', 'D'), rel('C', 'D')];
    const result = enforceAfterMove(initial, rels, 'A', 'B', TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'A')).toBe('B');
      expect(tierOf(result.assignments, 'B')).toBe('C');
      expect(tierOf(result.assignments, 'C')).toBe('C');
      expect(tierOf(result.assignments, 'D')).toBe('D');
    }
  });

  it('multi-parent: pushes all parents up when a shared child moves up', () => {
    // Consistent: A:A, X:A, B:F.  Move B to B (idx 2) — both A and X must go above.
    const initial = [at('A', 'A'), at('X', 'A'), at('B', 'F')];
    const rels = [rel('A', 'B'), rel('X', 'B')];
    const result = enforceAfterMove(initial, rels, 'B', 'B', TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'B')).toBe('B');
      // Both parents must end up strictly above B (idx < 2)
      const aIdx = TIERS.indexOf(tierOf(result.assignments, 'A')!);
      const xIdx = TIERS.indexOf(tierOf(result.assignments, 'X')!);
      expect(aIdx).toBeLessThan(2);
      expect(xIdx).toBeLessThan(2);
    }
  });

  it('multi-parent blocked: no room if shared child moves to top', () => {
    // A:C, X:C, B:F. Move B to S — both A, X must go above S → impossible.
    const initial = [at('A', 'C'), at('X', 'C'), at('B', 'F')];
    const rels = [rel('A', 'B'), rel('X', 'B')];
    const result = enforceAfterMove(initial, rels, 'B', 'S', TIERS);
    expect(result.ok).toBe(false);
  });

  it('mesh (transitive + direct): A>B, B>C, A>C — move A down cascades correctly', () => {
    // A:S, B:A, C:B. Move A down to C → B must be at D, C at F.
    const initial = [at('A', 'S'), at('B', 'A'), at('C', 'B')];
    const rels = [rel('A', 'B'), rel('B', 'C'), rel('A', 'C')];
    const result = enforceAfterMove(initial, rels, 'A', 'C', TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'A')).toBe('C');
      expect(tierOf(result.assignments, 'B')).toBe('D');
      expect(tierOf(result.assignments, 'C')).toBe('F');
    }
  });

  it('non-strict chain: A >= B >= C — all can stay in same tier after move', () => {
    // A:B, B:B, C:B. Move A to A (idx 1). B and C can stay at B (non-strict allows ≤).
    const initial = [at('A', 'B'), at('B', 'B'), at('C', 'B')];
    const rels = [rel('A', 'B', false), rel('B', 'C', false)];
    const result = enforceAfterMove(initial, rels, 'A', 'A', TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'A')).toBe('A');
      // B and C don't need to move — they're still at-or-below A.
      expect(tierOf(result.assignments, 'B')).toBe('B');
      expect(tierOf(result.assignments, 'C')).toBe('B');
    }
  });

  it('mixed strict/non-strict: A > B >= C — B and C can coexist when A moves', () => {
    // A:S, B:A, C:A (B >= C same tier OK; A > B strict). Move A to A — invalidates.
    // A must be strictly above B (>=1 gap). Cascade pushes B down, C follows.
    const initial = [at('A', 'S'), at('B', 'A'), at('C', 'A')];
    const rels = [rel('A', 'B', true), rel('B', 'C', false)];
    const result = enforceAfterMove(initial, rels, 'A', 'A', TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'A')).toBe('A');
      const bIdx = TIERS.indexOf(tierOf(result.assignments, 'B')!);
      const cIdx = TIERS.indexOf(tierOf(result.assignments, 'C')!);
      // A at idx 1. B must be strictly below (idx >= 2).
      expect(bIdx).toBeGreaterThanOrEqual(2);
      // C must be at or below B.
      expect(cIdx).toBeGreaterThanOrEqual(bIdx);
    }
  });

  it('unrelated subgraphs are untouched by a move', () => {
    // Two independent components: (A > B) and (X > Y). Move A; X/Y shouldn't change.
    const initial = [at('A', 'A'), at('B', 'B'), at('X', 'C'), at('Y', 'D')];
    const rels = [rel('A', 'B'), rel('X', 'Y')];
    const result = enforceAfterMove(initial, rels, 'A', 'S', TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'X')).toBe('C');
      expect(tierOf(result.assignments, 'Y')).toBe('D');
    }
  });

  it('long chain push-down consumes all available tiers', () => {
    // 5-chain: A > B > C > D > E. Set A:S, B:A, C:B, D:C, E:D (consistent).
    // Move A to D → B:D, C:D+1=F, D:F (clamped), E:F (clamped). Clamp causes violation → blocked.
    const initial = [at('A', 'S'), at('B', 'A'), at('C', 'B'), at('D', 'C'), at('E', 'D')];
    const rels = [rel('A', 'B'), rel('B', 'C'), rel('C', 'D'), rel('D', 'E')];
    const result = enforceAfterMove(initial, rels, 'A', 'D', TIERS);
    // With 6 tiers and a 5-step strict chain starting at D (idx 3), we need
    // positions 3,4,5,6,7 — only 3,4,5 are valid, so E would be clamped → blocked.
    expect(result.ok).toBe(false);
  });
});

describe('enforceWithinTierOrder', () => {
  it('returns input unchanged when no relationships', () => {
    const initial = [at('A', 'B', 0), at('C', 'B', 1)];
    expect(enforceWithinTierOrder(initial, [])).toEqual(initial);
  });

  it('topologically sorts non-strict pairs in the same tier', () => {
    // C >= A >= B, all in tier B. Expected order: C, A, B.
    const initial = [at('A', 'B', 1), at('B', 'B', 2), at('C', 'B', 0)];
    const rels = [rel('C', 'A', false), rel('A', 'B', false)];
    const result = enforceWithinTierOrder(initial, rels);
    const order = result
      .filter((a) => a.tier === 'B')
      .sort((x, y) => x.position - y.position)
      .map((a) => a.characterId);
    expect(order).toEqual(['C', 'A', 'B']);
  });

  it('uses position as tiebreaker when no constraint applies', () => {
    const initial = [at('A', 'B', 2), at('C', 'B', 0), at('D', 'B', 1)];
    const result = enforceWithinTierOrder(initial, []);
    const order = result
      .filter((a) => a.tier === 'B')
      .sort((x, y) => x.position - y.position)
      .map((a) => a.characterId);
    // No constraints → preserve incoming positions: C(0), D(1), A(2)
    expect(order).toEqual(['C', 'D', 'A']);
  });

  it('handles equality cycles (A=B) by preserving existing order', () => {
    // A >= B and B >= A — equality. Cycle in the within-tier graph.
    // Should fall through to "remaining" branch and use position.
    const initial = [at('A', 'B', 0), at('B', 'B', 1)];
    const rels = [rel('A', 'B', false), rel('B', 'A', false)];
    const result = enforceWithinTierOrder(initial, rels);
    expect(result.filter((a) => a.tier === 'B')).toHaveLength(2);
  });
});

describe('compactUpward', () => {
  it('moves a placed character with no relationships all the way to top', () => {
    const initial = [at('A', 'D')];
    const result = compactUpward(initial, [], TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'A')).toBe('S');
      expect(result.movedCount).toBe(1);
    }
  });

  it('leaves the list untouched when nothing is placed', () => {
    const result = compactUpward([], [rel('A', 'B')], TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assignments).toEqual([]);
      expect(result.movedCount).toBe(0);
    }
  });

  it('ignores relationships where one endpoint is unranked', () => {
    // A is placed at C; B (superior to A, so A should be below B) is unranked.
    // User hasn't placed B yet → the B>A relationship shouldn't anchor A.
    // A floats to top.
    const initial = [at('A', 'C')];
    const rels = [rel('B', 'A')];
    const result = compactUpward(initial, rels, TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'A')).toBe('S');
    }
  });

  it('collapses a strict chain to the top N tiers', () => {
    // A > B > C, all placed at F. Compact → S, A, B.
    const initial = [at('A', 'F'), at('B', 'F'), at('C', 'F')];
    const rels = [rel('A', 'B'), rel('B', 'C')];
    const result = compactUpward(initial, rels, TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'A')).toBe('S');
      expect(tierOf(result.assignments, 'B')).toBe('A');
      expect(tierOf(result.assignments, 'C')).toBe('B');
    }
  });

  it('collapses a non-strict chain to the single top tier', () => {
    // A >= B >= C, all placed at F. Compact → all at S.
    const initial = [at('A', 'F'), at('B', 'F'), at('C', 'F')];
    const rels = [rel('A', 'B', false), rel('B', 'C', false)];
    const result = compactUpward(initial, rels, TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'A')).toBe('S');
      expect(tierOf(result.assignments, 'B')).toBe('S');
      expect(tierOf(result.assignments, 'C')).toBe('S');
    }
  });

  it('refuses when a strict chain is longer than the tier list', () => {
    // 7-node strict chain in 6-tier list → fail.
    const chain = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const initial = chain.map((id) => at(id, 'F'));
    const rels: Relationship[] = [];
    for (let i = 0; i < chain.length - 1; i++) rels.push(rel(chain[i], chain[i + 1]));
    const names = new Map(chain.map((id) => [id, id]));
    const result = compactUpward(initial, rels, TIERS, names);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/7 tiers/);
      expect(result.reason).toMatch(/only has 6/);
    }
  });

  it('does not count unranked links toward chain length', () => {
    // 6-tier list. Chain in the graph: A > B > C > D > E > F > G > H (8 long).
    // But only A and B are placed; the rest are unranked → compact ignores them.
    const initial = [at('A', 'F'), at('B', 'F')];
    const rels: Relationship[] = [
      rel('A', 'B'), rel('B', 'C'), rel('C', 'D'),
      rel('D', 'E'), rel('E', 'F'), rel('F', 'G'), rel('G', 'H'),
    ];
    const result = compactUpward(initial, rels, TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(tierOf(result.assignments, 'A')).toBe('S');
      expect(tierOf(result.assignments, 'B')).toBe('A');
    }
  });

  it('reports zero moved when the list is already compact', () => {
    const initial = [at('A', 'S'), at('B', 'A')];
    const rels = [rel('A', 'B')];
    const result = compactUpward(initial, rels, TIERS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.movedCount).toBe(0);
  });
});

describe('maxChainLength', () => {
  it('returns 0 for an empty graph', () => {
    expect(maxChainLength([])).toBe(0);
  });

  it('returns 1 for an A=B (no strict gap)', () => {
    const rels = [rel('A', 'B', false), rel('B', 'A', false)];
    expect(maxChainLength(rels)).toBe(1);
  });

  it('counts strict edges only', () => {
    // A > B >= C > D — strict depth is 3 (A,B/C,D) so needs 3 tiers.
    const rels = [rel('A', 'B', true), rel('B', 'C', false), rel('C', 'D', true)];
    expect(maxChainLength(rels)).toBe(3);
  });

  it('returns the longest of multiple chains', () => {
    // Short: X > Y. Long: A > B > C > D.
    const rels = [
      rel('X', 'Y'),
      rel('A', 'B'), rel('B', 'C'), rel('C', 'D'),
    ];
    expect(maxChainLength(rels)).toBe(4);
  });
});
