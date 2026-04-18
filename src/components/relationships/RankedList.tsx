import { useMemo, useState } from 'react';
import type { Relationship, Character, TierDefinition } from '../../types';
import { DEFAULT_TIER_DEFS } from '../../types';
import { buildGraph, topologicalSort, deriveLayeredRanking } from '../../lib/graph';
import { updateTierAssignments, ensureTierList, useTierList } from '../../hooks/use-tier-list';

interface Props {
  relationships: Relationship[];
  characters: Character[];
}

export function RankedList({ relationships, characters }: Props) {
  const [applied, setApplied] = useState(false);
  const tierList = useTierList();
  const tierDefs: TierDefinition[] = tierList?.tierDefs ?? DEFAULT_TIER_DEFS;

  const charMap = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters],
  );

  const layers = useMemo(() => {
    if (relationships.length === 0) return null;
    const graph = buildGraph(relationships);
    return deriveLayeredRanking(graph);
  }, [relationships]);

  const sorted = useMemo(() => {
    if (relationships.length === 0) return null;
    const graph = buildGraph(relationships);
    return topologicalSort(graph);
  }, [relationships]);

  const sortedLayers = useMemo(() => {
    if (!layers) return null;
    return [...layers.entries()].sort(([a], [b]) => a - b);
  }, [layers]);

  async function applyToTierList() {
    if (!sortedLayers) return;
    await ensureTierList();

    // Map graph layers to tier defs. If more layers than tiers, compress.
    const tierAssignments: { characterId: string; tier: string; position: number }[] = [];

    for (const [layerIdx, ids] of sortedLayers) {
      const tierIdx = Math.min(layerIdx, tierDefs.length - 1);
      const tier = tierDefs[tierIdx];
      const existingInTier = tierAssignments.filter((a) => a.tier === tier.id).length;
      ids.forEach((id, i) => {
        if (charMap.has(id)) {
          tierAssignments.push({
            characterId: id,
            tier: tier.id,
            position: existingInTier + i,
          });
        }
      });
    }

    await updateTierAssignments(tierAssignments);
    setApplied(true);
    setTimeout(() => setApplied(false), 2500);
  }

  if (!sorted && !layers) {
    return (
      <p className="text-sm text-gray-500 py-4">
        Add relationships to see a derived ranking.
      </p>
    );
  }

  if (!sorted) {
    return (
      <p className="text-sm text-yellow-400 py-4">
        Cannot produce a ranking due to circular relationships. Resolve cycles first.
      </p>
    );
  }

  if (sortedLayers) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-300">Derived Ranking</h3>
          <button
            onClick={applyToTierList}
            className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
          >
            {applied ? 'Applied!' : 'Apply to Tier List'}
          </button>
        </div>
        {sortedLayers.map(([layer, ids]) => {
          const tierIdx = Math.min(layer, tierDefs.length - 1);
          const tier = tierDefs[tierIdx];
          return (
            <div key={layer} className="flex items-start gap-3">
              <span
                className="text-xs font-bold w-8 h-6 flex items-center justify-center rounded shrink-0"
                style={{ backgroundColor: tier.color, color: '#141414' }}
              >
                {tier.name}
              </span>
              <div className="flex flex-wrap gap-1">
                {ids.map((id) => {
                  const char = charMap.get(id);
                  return char ? (
                    <span
                      key={id}
                      className="text-xs px-2 py-1 rounded bg-[#2a2a2a] text-gray-300 border border-gray-700"
                    >
                      {char.name}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          );
        })}
        <p className="text-[10px] text-gray-500">
          Layers are mapped to tiers. Click "Apply to Tier List" to auto-place.
        </p>
      </div>
    );
  }

  return null;
}
