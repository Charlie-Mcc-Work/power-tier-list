import type { Relationship } from '../types';

export interface RedundancyInfo {
  /** Node IDs of the implying path — first = superior of the redundant rel, last = inferior. */
  path: string[];
  /** edgeStrict[i] is the strictness of the edge path[i] → path[i+1]. Length = path.length − 1. */
  edgeStrict: boolean[];
}

/**
 * A relationship A ≷ B is redundant if an alternative path A → … → B (not
 * using this edge) already enforces it:
 *   - A > B  (strict):    alt path must contain ≥ 1 strict edge
 *   - A >= B (non-strict): any alt path suffices (strict edges are stronger,
 *     non-strict edges match its requirement exactly)
 *
 * Returns a map from redundant relationship id to the path that implies it.
 */
export function findRedundantRelationships(
  relationships: Relationship[],
): Map<string, RedundancyInfo> {
  const result = new Map<string, RedundancyInfo>();

  interface Edge {
    to: string;
    strict: boolean;
    relId: string;
  }
  const adj = new Map<string, Edge[]>();
  const nodes = new Set<string>();
  for (const r of relationships) {
    nodes.add(r.superiorId);
    nodes.add(r.inferiorId);
    if (!adj.has(r.superiorId)) adj.set(r.superiorId, []);
    adj.get(r.superiorId)!.push({
      to: r.inferiorId,
      strict: r.strict ?? false,
      relId: r.id,
    });
  }

  for (const rel of relationships) {
    const requiredStrict = rel.strict ?? false;
    const alt = findMaxStrictPath(adj, nodes.size, rel.superiorId, rel.inferiorId, rel.id);
    if (!alt) continue;

    const strictCount = alt.edgeStrict.reduce((n, s) => n + (s ? 1 : 0), 0);
    if (requiredStrict && strictCount < 1) continue;

    result.set(rel.id, alt);
  }

  return result;
}

/**
 * Find a path `start` → `end` that maximizes the strict-edge count, excluding
 * the edge with id `excludeRelId`. Uses Bellman-Ford-style relaxation — fine
 * for tier-list sizes (usually < 200 nodes). Returns null if unreachable.
 *
 * Non-strict cycles contribute 0 strict weight, so extra loops never improve
 * the count; the fixpoint converges in at most |V| passes.
 */
function findMaxStrictPath(
  adj: Map<string, Array<{ to: string; strict: boolean; relId: string }>>,
  nodeCount: number,
  start: string,
  end: string,
  excludeRelId: string,
): RedundancyInfo | null {
  if (start === end) return null;

  const dist = new Map<string, number>();
  const prev = new Map<string, { from: string; strict: boolean }>();
  dist.set(start, 0);

  const MAX_ITER = Math.max(2, nodeCount + 1);
  let changed = true;
  let iter = 0;
  while (changed && iter < MAX_ITER) {
    changed = false;
    iter++;
    for (const [from, edges] of adj) {
      const d = dist.get(from);
      if (d == null) continue;
      for (const edge of edges) {
        if (edge.relId === excludeRelId) continue;
        const newD = d + (edge.strict ? 1 : 0);
        const existing = dist.get(edge.to);
        if (existing == null || newD > existing) {
          dist.set(edge.to, newD);
          prev.set(edge.to, { from, strict: edge.strict });
          changed = true;
        }
      }
    }
  }

  if (!dist.has(end)) return null;

  const nodes: string[] = [end];
  const edgeStrict: boolean[] = [];
  const visited = new Set<string>([end]);
  let cur = end;
  while (cur !== start) {
    const p = prev.get(cur);
    if (!p || visited.has(p.from)) return null; // shouldn't happen; guard
    nodes.unshift(p.from);
    edgeStrict.unshift(p.strict);
    visited.add(p.from);
    cur = p.from;
  }

  return { path: nodes, edgeStrict };
}
