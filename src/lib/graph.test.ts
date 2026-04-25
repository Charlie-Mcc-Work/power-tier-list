import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  detectCycles,
  wouldCreateCycle,
  findUnsatisfiableCycle,
} from './graph';
import type { Relationship } from '../types';

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

describe('buildGraph', () => {
  it('returns empty graph for no relationships', () => {
    expect(buildGraph([]).size).toBe(0);
  });

  it('adds both endpoints as nodes even with one edge', () => {
    const g = buildGraph([rel('A', 'B')]);
    expect(g.has('A')).toBe(true);
    expect(g.has('B')).toBe(true);
    expect(g.get('A')!.has('B')).toBe(true);
    expect(g.get('B')!.size).toBe(0);
  });

  it('deduplicates parallel edges', () => {
    const g = buildGraph([rel('A', 'B'), rel('A', 'B', false)]);
    expect(g.get('A')!.size).toBe(1);
  });
});

describe('detectCycles', () => {
  it('returns no cycles for a DAG', () => {
    const g = buildGraph([rel('A', 'B'), rel('B', 'C'), rel('A', 'C')]);
    expect(detectCycles(g)).toEqual([]);
  });

  it('finds a 2-node cycle', () => {
    const g = buildGraph([rel('A', 'B'), rel('B', 'A')]);
    const cycles = detectCycles(g);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].sort()).toEqual(['A', 'B']);
  });

  it('finds a 3-node cycle', () => {
    const g = buildGraph([rel('A', 'B'), rel('B', 'C'), rel('C', 'A')]);
    const cycles = detectCycles(g);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].sort()).toEqual(['A', 'B', 'C']);
  });

  it('finds multiple disjoint cycles', () => {
    const g = buildGraph([
      rel('A', 'B'), rel('B', 'A'),
      rel('X', 'Y'), rel('Y', 'X'),
    ]);
    expect(detectCycles(g)).toHaveLength(2);
  });

  it('does not flag self-edges as size>1 cycles', () => {
    // Self-loops would be size-1 SCCs and are filtered out by detectCycles
    // (the implementation only returns sccs with length > 1)
    const rels = [{ ...rel('A', 'A'), id: 'self' }];
    const g = buildGraph(rels);
    expect(detectCycles(g)).toEqual([]);
  });
});

describe('wouldCreateCycle', () => {
  it('returns false when no path exists from inferior back to superior', () => {
    const g = buildGraph([rel('A', 'B')]);
    expect(wouldCreateCycle(g, 'A', 'C')).toBe(false);
  });

  it('returns true when adding the edge would close a cycle', () => {
    const g = buildGraph([rel('A', 'B'), rel('B', 'C')]);
    // Add C > A would close A > B > C > A
    expect(wouldCreateCycle(g, 'C', 'A')).toBe(true);
  });

  it('returns true for the trivial 2-node cycle', () => {
    const g = buildGraph([rel('A', 'B')]);
    expect(wouldCreateCycle(g, 'B', 'A')).toBe(true);
  });

  it('returns false when nodes are not yet in the graph', () => {
    const g = buildGraph([rel('A', 'B')]);
    expect(wouldCreateCycle(g, 'X', 'Y')).toBe(false);
  });
});

describe('findUnsatisfiableCycle', () => {
  it('returns null when no cycle would form', () => {
    const g = buildGraph([rel('A', 'B')]);
    expect(findUnsatisfiableCycle(g, 'A', 'C')).toBeNull();
  });

  it('returns the cycle path when a strict edge closes a cycle', () => {
    const g = buildGraph([rel('A', 'B'), rel('B', 'C')]);
    // Adding C > A closes A > B > C > A — unsatisfiable.
    const result = findUnsatisfiableCycle(g, 'C', 'A');
    expect(result).not.toBeNull();
    expect(result).toContain('A');
    expect(result).toContain('B');
    expect(result).toContain('C');
  });

  it('rejects an all-non-strict cycle (would require A before B AND B before A)', () => {
    // Under the new semantics, `>=` enforces positional order inside a
    // tier. A cycle A >= B >= C >= A forces A before B before C before A —
    // impossible.
    const g = buildGraph([rel('A', 'B', false), rel('B', 'C', false)]);
    expect(findUnsatisfiableCycle(g, 'C', 'A')).not.toBeNull();
  });

  it('blocks a non-strict edge when the cycle contains a strict edge', () => {
    const g = buildGraph([rel('A', 'B', true), rel('B', 'C', false)]);
    // Adding C >= A closes a cycle — unsatisfiable regardless of the mix.
    expect(findUnsatisfiableCycle(g, 'C', 'A')).not.toBeNull();
  });

  it('rejects the bidirectional-non-strict pair (would-be former equality)', () => {
    // Adding B >= A on top of an existing A >= B used to be an "equality"
    // (allowed). Now it's a 2-node cycle with contradictory position order.
    const g = buildGraph([rel('A', 'B', false)]);
    expect(findUnsatisfiableCycle(g, 'B', 'A')).not.toBeNull();
  });
});

