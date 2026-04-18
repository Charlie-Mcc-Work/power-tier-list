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

/** Kahn's algorithm — returns ordered IDs (strongest first) or null if cycles exist */
export function topologicalSort(graph: AdjacencyList): string[] | null {
  const inDegree = new Map<string, number>();
  for (const node of graph.keys()) inDegree.set(node, 0);
  for (const neighbors of graph.values()) {
    for (const n of neighbors) {
      inDegree.set(n, (inDegree.get(n) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [node, deg] of inDegree) {
    if (deg === 0) queue.push(node);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const neighbor of graph.get(node) ?? []) {
      const newDeg = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return sorted.length === graph.size ? sorted : null;
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

/** Assign layer numbers (0 = strongest, higher = weaker). Returns null if cycles exist. */
export function deriveLayeredRanking(graph: AdjacencyList): Map<number, string[]> | null {
  const sorted = topologicalSort(graph);
  if (!sorted) return null;

  const layers = new Map<string, number>();

  // Process in reverse topological order so we can compute layers bottom-up
  for (const node of [...sorted].reverse()) {
    let maxChildLayer = -1;
    for (const child of graph.get(node) ?? []) {
      maxChildLayer = Math.max(maxChildLayer, layers.get(child) ?? 0);
    }
    layers.set(node, maxChildLayer + 1);
  }

  // Invert: highest layer number = strongest = layer 0 in output
  const maxLayer = Math.max(...layers.values(), 0);
  const result = new Map<number, string[]>();
  for (const [node, layer] of layers) {
    const outputLayer = maxLayer - layer;
    if (!result.has(outputLayer)) result.set(outputLayer, []);
    result.get(outputLayer)!.push(node);
  }

  return result;
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
 * A cycle of all non-strict (>=) edges is fine — it just means "same tier."
 * A cycle with ANY strict (>) edge is unsatisfiable — you can't have a
 * tier gap in a loop.
 *
 * Returns null if no problem, or the cycle path as character IDs if blocked.
 */
export function findUnsatisfiableCycle(
  graph: AdjacencyList,
  edgeStrictness: Map<string, boolean>,
  superiorId: string,
  inferiorId: string,
  newEdgeStrict: boolean,
): string[] | null {
  if (!wouldCreateCycle(graph, superiorId, inferiorId)) return null;

  // BFS from inferiorId to superiorId to find the existing path
  const parent = new Map<string, string>();
  const queue = [inferiorId];
  const visited = new Set([inferiorId]);

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === superiorId) break;
    for (const neighbor of graph.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, node);
        queue.push(neighbor);
      }
    }
  }

  // Reconstruct the cycle path
  const path: string[] = [superiorId];
  let cur = superiorId;
  while (cur !== inferiorId) {
    const prev = parent.get(cur);
    if (!prev) return [superiorId, inferiorId]; // fallback
    path.unshift(prev);
    cur = prev;
  }

  // If the new edge is strict, the cycle is unsatisfiable
  if (newEdgeStrict) return path;

  // New edge is non-strict — only blocked if an existing edge in the path is strict
  for (let i = 0; i < path.length - 1; i++) {
    const key = `${path[i]}->${path[i + 1]}`;
    if (edgeStrictness.get(key)) return path;
  }

  // All edges non-strict — cycle is satisfiable (same tier)
  return null;
}
