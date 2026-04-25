import type { Relationship } from '../types';

export type AdjacencyList = Map<string, Set<string>>;

export function buildGraph(relationships: Relationship[]): AdjacencyList {
  const graph: AdjacencyList = new Map();
  for (const rel of relationships) {
    if (!graph.has(rel.superiorId)) graph.set(rel.superiorId, new Set());
    if (!graph.has(rel.inferiorId)) graph.set(rel.inferiorId, new Set());
    graph.get(rel.superiorId)!.add(rel.inferiorId);
  }
  return graph;
}

/** Tarjan's SCC — returns arrays of cycle members (strongly connected components with size > 1) */
export function detectCycles(graph: AdjacencyList): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const sccs: string[][] = [];

  function strongConnect(v: string) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of graph.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) sccs.push(scc);
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) strongConnect(node);
  }

  return sccs;
}

/** Check if adding an edge would create a directed cycle (DFS from inferior to superior) */
export function wouldCreateCycle(
  graph: AdjacencyList,
  superiorId: string,
  inferiorId: string,
): boolean {
  const visited = new Set<string>();
  const stack = [inferiorId];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === superiorId) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const neighbor of graph.get(node) ?? []) {
      stack.push(neighbor);
    }
  }
  return false;
}

/**
 * Check if adding an edge would create an UNSATISFIABLE cycle.
 *
 * Under the current model both `>` and `>=` enforce positional ordering
 * (strict makes a tier gap; non-strict puts A before B inside one tier).
 * So **any** cycle is unsatisfiable — you can't have `A before B` AND
 * `B before A` simultaneously, whether the gap is one tier or zero.
 *
 * Returns null if safe, or the cycle path (as character IDs) if blocked.
 */
export function findUnsatisfiableCycle(
  graph: AdjacencyList,
  superiorId: string,
  inferiorId: string,
): string[] | null {
  if (!wouldCreateCycle(graph, superiorId, inferiorId)) return null;
  return bfsShortestPath(graph, inferiorId, superiorId) ?? [superiorId, inferiorId];
}

function bfsShortestPath(
  graph: AdjacencyList,
  start: string,
  end: string,
): string[] | null {
  if (start === end) return [start];
  const parent = new Map<string, string>();
  const visited = new Set([start]);
  const queue = [start];
  let found = false;
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === end) { found = true; break; }
    for (const n of graph.get(node) ?? []) {
      if (!visited.has(n)) {
        visited.add(n);
        parent.set(n, node);
        queue.push(n);
      }
    }
  }
  if (!found && !parent.has(end)) return null;
  const path: string[] = [end];
  let cur = end;
  while (cur !== start) {
    const prev = parent.get(cur);
    if (!prev) return null;
    path.unshift(prev);
    cur = prev;
  }
  return path;
}
