import { describe, it, expect } from 'vitest';
import { findInconsistencies } from './inconsistency-checker';
import type { Character, Relationship, TierAssignment } from '../types';

const TIERS = ['S', 'A', 'B', 'C', 'D', 'F'];

function ch(id: string, name = id): Character {
  return { id, tierListId: 't', name, createdAt: 0, updatedAt: 0 };
}

function rel(superiorId: string, inferiorId: string, strict = true): Relationship {
  return {
    id: `${superiorId}->${inferiorId}`,
    tierListId: 't',
    superiorId,
    inferiorId,
    strict,
    createdAt: 0,
  };
}

function at(charId: string, tier: string, position = 0): TierAssignment {
  return { characterId: charId, tier, position };
}

describe('findInconsistencies', () => {
  it('returns empty when constraints are satisfied', () => {
    const result = findInconsistencies(
      [at('A', 'S'), at('B', 'A')],
      [rel('A', 'B')],
      [ch('A'), ch('B')],
      TIERS,
    );
    expect(result).toEqual([]);
  });

  it('flags A > B when A is below B', () => {
    const result = findInconsistencies(
      [at('A', 'C'), at('B', 'S')],
      [rel('A', 'B', true)],
      [ch('A'), ch('B')],
      TIERS,
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('placement');
    expect(result[0].message).toContain('ranked below');
  });

  it('flags A > B when both are in the same tier (strict)', () => {
    const result = findInconsistencies(
      [at('A', 'B'), at('B', 'B')],
      [rel('A', 'B', true)],
      [ch('A'), ch('B')],
      TIERS,
    );
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain('same tier');
  });

  it('does NOT flag A >= B when both in same tier and A is positioned before B', () => {
    const result = findInconsistencies(
      [at('A', 'B', 0), at('B', 'B', 1)],
      [rel('A', 'B', false)],
      [ch('A'), ch('B')],
      TIERS,
    );
    expect(result).toEqual([]);
  });

  it('flags A >= B when they are in different tiers', () => {
    const result = findInconsistencies(
      [at('A', 'S'), at('B', 'B')],
      [rel('A', 'B', false)],
      [ch('A'), ch('B')],
      TIERS,
    );
    expect(result).toHaveLength(1);
    expect(result[0].message).toMatch(/different tiers/i);
  });

  it('flags A >= B when A is positioned after B within the same tier', () => {
    const result = findInconsistencies(
      [at('A', 'B', 1), at('B', 'B', 0)],
      [rel('A', 'B', false)],
      [ch('A'), ch('B')],
      TIERS,
    );
    expect(result).toHaveLength(1);
    expect(result[0].message).toMatch(/positioned after/i);
  });

  it('skips relationships where one endpoint is unranked', () => {
    const result = findInconsistencies(
      [at('A', 'S')], // B not placed
      [rel('A', 'B')],
      [ch('A'), ch('B')],
      TIERS,
    );
    expect(result).toEqual([]);
  });

  it('detects strict cycles', () => {
    const result = findInconsistencies(
      [at('A', 'S'), at('B', 'A'), at('C', 'B')],
      [rel('A', 'B'), rel('B', 'C'), rel('C', 'A')],
      [ch('A'), ch('B'), ch('C')],
      TIERS,
    );
    const cycleIssue = result.find((r) => r.type === 'cycle');
    expect(cycleIssue).toBeDefined();
  });

  it('skips relationships where a character sits in a deleted/renamed tier', () => {
    // Character A assigned to tier 'OLD' which is not in the current tierIds.
    // Previously this silently mapped to idx 0 and produced spurious warnings.
    const result = findInconsistencies(
      [at('A', 'OLD'), at('B', 'C')],
      [rel('A', 'B', true)],
      [ch('A'), ch('B')],
      TIERS,
    );
    expect(result).toEqual([]);
  });

  it('flags all-non-strict cycles (unsatisfiable under the new positional model)', () => {
    // A >= B AND B >= A would force A before B AND B before A simultaneously
    // — impossible. The cycle check at add-time rejects this, but if stale
    // data holds such a pair, the inconsistency banner now surfaces it.
    const result = findInconsistencies(
      [at('A', 'S'), at('B', 'S')],
      [rel('A', 'B', false), rel('B', 'A', false)],
      [ch('A'), ch('B')],
      TIERS,
    );
    const cycleIssue = result.find((r) => r.type === 'cycle');
    expect(cycleIssue).toBeDefined();
  });
});
