import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  topologicalSort,
  detectCycles,
  wouldCreateCycle,
  findUnsatisfiableCycle,
  deriveLayeredRanking,
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

describe('topologicalSort', () => {
  it('returns nodes in topological order for a DAG', () => {
    const g = buildGraph([rel('A', 'B'), rel('B', 'C')]);
    const sorted = topologicalSort(g);
    expect(sorted).not.toBeNull();
    expect(sorted!.indexOf('A')).toBeLessThan(sorted!.indexOf('B'));
    expect(sorted!.indexOf('B')).toBeLessThan(sorted!.indexOf('C'));
  });

  it('returns null when a cycle exists', () => {
    const g = buildGraph([rel('A', 'B'), rel('B', 'A')]);
    expect(topologicalSort(g)).toBeNull();
  });

  it('handles disconnected components', () => {
    const g = buildGraph([rel('A', 'B'), rel('C', 'D')]);
    const sorted = topologicalSort(g);
    expect(sorted).toHaveLength(4);
  });

  it('returns empty array for empty graph', () => {
    expect(topologicalSort(buildGraph([]))).toEqual([]);
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
    const result = findUnsatisfiableCycle(g, new Map(), 'A', 'C', true);
    expect(result).toBeNull();
  });

  it('returns the cycle path when a strict edge closes a cycle', () => {
    const rels = [rel('A', 'B'), rel('B', 'C')];
    const g = buildGraph(rels);
    const strictness = new Map(rels.map((r) => [`${r.superiorId}->${r.inferiorId}`, r.strict]));
    // Adding C > A (strict) closes A > B > C > A — unsatisfiable.
    const result = findUnsatisfiableCycle(g, strictness, 'C', 'A', true);
    expect(result).not.toBeNull();
    expect(result).toContain('A');
    expect(result).toContain('B');
    expect(result).toContain('C');
  });

  it('allows an all-non-strict cycle (means "same tier")', () => {
    const rels = [rel('A', 'B', false), rel('B', 'C', false)];
    const g = buildGraph(rels);
    const strictness = new Map(rels.map((r) => [`${r.superiorId}->${r.inferiorId}`, r.strict]));
    // Adding C >= A (non-strict) to all-non-strict cycle is satisfiable.
    const result = findUnsatisfiableCycle(g, strictness, 'C', 'A', false);
    expect(result).toBeNull();
  });

  it('blocks a non-strict edge when the cycle contains a strict edge', () => {
    const rels = [rel('A', 'B', true), rel('B', 'C', false)]; // A > B, B >= C
    const g = buildGraph(rels);
    const strictness = new Map(rels.map((r) => [`${r.superiorId}->${r.inferiorId}`, r.strict]));
    // Adding C >= A — closes A > B >= C >= A which has a strict edge → unsatisfiable.
    const result = findUnsatisfiableCycle(g, strictness, 'C', 'A', false);
    expect(result).not.toBeNull();
  });
});

describe('deriveLayeredRanking', () => {
  it('returns null on cycle', () => {
    const g = buildGraph([rel('A', 'B'), rel('B', 'A')]);
    expect(deriveLayeredRanking(g)).toBeNull();
  });

  it('places source nodes at layer 0', () => {
    const g = buildGraph([rel('A', 'B'), rel('B', 'C')]);
    const layers = deriveLayeredRanking(g)!;
    expect(layers.get(0)).toEqual(['A']);
    expect(layers.get(2)).toEqual(['C']);
  });

  it('handles wide DAGs (siblings at same layer)', () => {
    const g = buildGraph([rel('A', 'B'), rel('A', 'C')]);
    const layers = deriveLayeredRanking(g)!;
    expect(layers.get(0)).toEqual(['A']);
    expect(layers.get(1)!.sort()).toEqual(['B', 'C']);
  });
});
