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

  const cycles = useMemo(() => {
    if (relationships.length === 0) return [];
    const graph = buildGraph(relationships);
    return detectCycles(graph);
  }, [relationships]);

  if (cycles.length === 0) return null;

  return (
    <div className="rounded-lg border border-red-600/50 bg-red-900/20 p-3">
      <h3 className="text-sm font-medium text-red-400 mb-2">
        Circular Rankings Detected
      </h3>
      <ul className="space-y-1">
        {cycles.map((cycle, i) => {
          const names = cycle.map((id) => charMap.get(id)?.name ?? '?');
          return (
            <li key={i} className="text-xs text-red-300/80">
              {names.join(' > ')} {'>'} {names[0]}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-gray-400 mt-2">
        Remove or reverse one of the relationships in each cycle to resolve.
      </p>
    </div>
  );
}
