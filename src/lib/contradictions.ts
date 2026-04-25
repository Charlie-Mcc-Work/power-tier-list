import type { Relationship } from '../types';
import { buildGraph, detectCycles } from './graph';

/**
 * Shortest path between two nodes in the *undirected* `>=` subgraph.
 * Returns the relationship IDs along the path and the node sequence, or
 * null if no such path exists.
 */
function shortestNonStrictPath(
  start: string,
  end: string,
  relationships: Relationship[],
): { nodes: string[]; relIds: string[] } | null {
  if (start === end) return { nodes: [start], relIds: [] };

  const adj = new Map<string, Map<string, string>>();
  for (const r of relationships) {
    if (r.strict ?? false) continue;
    if (!adj.has(r.superiorId)) adj.set(r.superiorId, new Map());
    if (!adj.has(r.inferiorId)) adj.set(r.inferiorId, new Map());
    // First-write-wins; if multiple `>=` rels exist between the same pair,
    // we'll attribute the path to whichever was indexed first — the user
    // sees all of them anyway since they share endpoints.
    if (!adj.get(r.superiorId)!.has(r.inferiorId)) {
      adj.get(r.superiorId)!.set(r.inferiorId, r.id);
    }
    if (!adj.get(r.inferiorId)!.has(r.superiorId)) {
      adj.get(r.inferiorId)!.set(r.superiorId, r.id);
    }
  }

  if (!adj.has(start) || !adj.has(end)) return null;

  const parent = new Map<string, { node: string; relId: string }>();
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === end) break;
    for (const [neighbor, relId] of adj.get(node) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      parent.set(neighbor, { node, relId });
      queue.push(neighbor);
    }
  }

  if (!parent.has(end)) return null;

  const nodes: string[] = [end];
  const relIds: string[] = [];
  let cur = end;
  while (cur !== start) {
    const p = parent.get(cur);
    if (!p) return null;
    nodes.unshift(p.node);
    relIds.unshift(p.relId);
    cur = p.node;
  }
  return { nodes, relIds };
}

export interface ContradictionGroup {
  /** Stable ID for React keys — the root of the connected component. */
  id: string;
  /** Character IDs involved in the group. */
  characterIds: string[];
  /** Relationship IDs participating in the contradiction. */
  relationshipIds: Set<string>;
  /** A short plain-language description of the conflict. */
  summary: string;
}

/**
 * Find contradictions in the relationship set and group them by connected
 * component (contradictions that share any character go in one group).
 *
 * Under the current model:
 *   - `>` forces a tier gap
 *   - `>=` forces the same tier (with A positioned before B)
 *
 * Two kinds of contradictions can arise:
 *
 * 1. **Graph cycles** — any strongly-connected component of size > 1 in
 *    the rel DAG. Every char in the cycle would have to be both before
 *    and after itself.
 * 2. **Strict-within-class** — a `>` edge whose endpoints are already
 *    unified into the same tier by a chain of `>=` edges. The chain says
 *    "same tier", the `>` says "tier gap" — impossible.
 *
 * Each group bundles every rel participating in the contradiction so the
 * user can see all the edges they'd need to pick between.
 */
export function findContradictions(
  relationships: Relationship[],
): ContradictionGroup[] {
  const contradictoryChars = new Set<string>();
  const contradictoryRelIds = new Set<string>();

  // (1) Graph cycles: every rel between two SCC members participates.
  const graph = buildGraph(relationships);
  const sccs = detectCycles(graph);
  for (const scc of sccs) {
    const sccSet = new Set(scc);
    for (const id of scc) contradictoryChars.add(id);
    for (const rel of relationships) {
      if (sccSet.has(rel.superiorId) && sccSet.has(rel.inferiorId)) {
        contradictoryRelIds.add(rel.id);
      }
    }
  }

  // (2) Strict-within-class: union-find over `>=` edges, then for each
  // strict edge whose endpoints share a class, surface only the shortest
  // `>=` path connecting them. This keeps the displayed group tight —
  // unrelated `>=` edges that happen to extend the class (e.g. branches
  // off to characters not on any path between the strict's endpoints)
  // are filtered out so the user can see exactly the rels they need to
  // pick between to break the conflict.
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
  for (const rel of relationships) {
    if (!(rel.strict ?? false)) continue;
    if (find(rel.superiorId) !== find(rel.inferiorId)) continue;
    const path = shortestNonStrictPath(rel.superiorId, rel.inferiorId, relationships);
    if (!path) continue;
    contradictoryRelIds.add(rel.id);
    contradictoryChars.add(rel.superiorId);
    contradictoryChars.add(rel.inferiorId);
    for (const node of path.nodes) contradictoryChars.add(node);
    for (const id of path.relIds) contradictoryRelIds.add(id);
  }

  // (3) Class-level cycle: build a DAG where each `>=` class is a single
  // node and strict edges connect classes. Any cycle here is unsatisfiable
  // (e.g. `A1 > B1` and `B2 > A2` with `A1 = A2` and `B1 = B2` makes
  // tier(A1) < tier(A1)). The original-graph SCC and strict-within-class
  // checks both miss this because no node is on a cycle in the rel DAG and
  // no strict edge sits inside one class.
  const classGraph = new Map<string, Set<string>>();
  for (const rel of relationships) {
    if (!(rel.strict ?? false)) continue;
    const supC = find(rel.superiorId);
    const infC = find(rel.inferiorId);
    if (supC === infC) continue;
    if (!classGraph.has(supC)) classGraph.set(supC, new Set());
    classGraph.get(supC)!.add(infC);
  }
  const classSCCs = detectCycles(classGraph);
  for (const scc of classSCCs) {
    const sccClassSet = new Set(scc);
    const endpointsPerClass = new Map<string, Set<string>>();
    for (const cls of sccClassSet) endpointsPerClass.set(cls, new Set());

    // Strict edges that participate (both endpoints' classes in the SCC).
    for (const rel of relationships) {
      if (!(rel.strict ?? false)) continue;
      const supC = find(rel.superiorId);
      const infC = find(rel.inferiorId);
      if (supC === infC) continue;
      if (!sccClassSet.has(supC) || !sccClassSet.has(infC)) continue;
      contradictoryRelIds.add(rel.id);
      contradictoryChars.add(rel.superiorId);
      contradictoryChars.add(rel.inferiorId);
      endpointsPerClass.get(supC)!.add(rel.superiorId);
      endpointsPerClass.get(infC)!.add(rel.inferiorId);
    }

    // Within each class involved in the cycle, surface the shortest `>=`
    // paths connecting endpoints — those are the chains keeping the
    // strict edges' endpoints unified into one tier.
    for (const endpoints of endpointsPerClass.values()) {
      const list = [...endpoints];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const path = shortestNonStrictPath(list[i], list[j], relationships);
          if (!path) continue;
          for (const node of path.nodes) contradictoryChars.add(node);
          for (const id of path.relIds) contradictoryRelIds.add(id);
        }
      }
    }
  }

  if (contradictoryRelIds.size === 0) return [];

  // Group by connected component of the contradictory subgraph — two
  // contradictions that share any character belong in the same group.
  const cparent = new Map<string, string>();
  function cfind(x: string): string {
    if (!cparent.has(x)) cparent.set(x, x);
    let r = x;
    while (cparent.get(r)! !== r) r = cparent.get(r)!;
    while (cparent.get(x)! !== r) {
      const p = cparent.get(x)!;
      cparent.set(x, r);
      x = p;
    }
    return r;
  }
  function cunion(a: string, b: string) {
    const ra = cfind(a), rb = cfind(b);
    if (ra !== rb) cparent.set(ra, rb);
  }
  for (const id of contradictoryChars) cfind(id);
  for (const rel of relationships) {
    if (contradictoryRelIds.has(rel.id)) {
      cunion(rel.superiorId, rel.inferiorId);
    }
  }

  const byRoot = new Map<
    string,
    { chars: Set<string>; relIds: Set<string>; strictCount: number; nonStrictCount: number }
  >();
  for (const id of contradictoryChars) {
    const root = cfind(id);
    if (!byRoot.has(root)) {
      byRoot.set(root, {
        chars: new Set(),
        relIds: new Set(),
        strictCount: 0,
        nonStrictCount: 0,
      });
    }
    byRoot.get(root)!.chars.add(id);
  }
  for (const rel of relationships) {
    if (!contradictoryRelIds.has(rel.id)) continue;
    const root = cfind(rel.superiorId);
    const group = byRoot.get(root)!;
    group.relIds.add(rel.id);
    if (rel.strict ?? false) group.strictCount++;
    else group.nonStrictCount++;
  }

  return [...byRoot.entries()].map(([root, data]) => {
    let summary: string;
    if (data.strictCount === 0) {
      summary = 'These `>=` relationships form a cycle — they can\'t all be satisfied (positions can\'t loop back on themselves)';
    } else if (data.nonStrictCount === 0) {
      summary = 'These `>` relationships form a cycle — no character can be strictly above itself';
    } else {
      summary = 'These `>` and `>=` relationships together require an impossible tier ordering — the `>` edge demands a gap that the surrounding `>=` chain forces back into the same tier';
    }
    return {
      id: root,
      characterIds: [...data.chars],
      relationshipIds: data.relIds,
      summary,
    };
  });
}
