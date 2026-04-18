import { useMemo } from 'react';
import type { Relationship, Character } from '../../types';
import { buildGraph, detectCycles } from '../../lib/graph';

interface Props {
  relationships: Relationship[];
  characters: Character[];
}

export function CycleWarning({ relationships, characters }: Props) {
  const charMap = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters],
  );

  const unsatisfiableCycles = useMemo(() => {
    if (relationships.length === 0) return [];
    const graph = buildGraph(relationships);
    const allCycles = detectCycles(graph);

    // Build a strictness lookup for edges
    const edgeStrict = new Map<string, boolean>();
    for (const rel of relationships) {
      edgeStrict.set(`${rel.superiorId}->${rel.inferiorId}`, rel.strict ?? false);
    }

    // Only keep cycles that contain at least one strict (>) edge.
    // A cycle of all non-strict (>=) edges is satisfiable (same tier).
    return allCycles.filter((cycle) => {
      for (let i = 0; i < cycle.length; i++) {
        const from = cycle[i];
        const to = cycle[(i + 1) % cycle.length];
        if (edgeStrict.get(`${from}->${to}`)) return true;
      }
      return false;
    });
  }, [relationships]);

  if (unsatisfiableCycles.length === 0) return null;

  return (
    <div className="rounded-lg border border-red-600/50 bg-red-900/20 p-3">
      <h3 className="text-sm font-medium text-red-400 mb-2">
        Circular Rankings Detected
      </h3>
      <ul className="space-y-1">
        {unsatisfiableCycles.map((cycle, i) => {
          const names = cycle.map((id) => charMap.get(id)?.name ?? '?');
          return (
            <li key={i} className="text-xs text-red-300/80">
              {names.join(' > ')} {'>'} {names[0]}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-gray-400 mt-2">
        A cycle with a strict (&gt;) edge can't be satisfied. Change one to &gt;= or remove it.
      </p>
    </div>
  );
}
