import { useMemo, useState } from 'react';
import type { Relationship, Character, TierRank } from '../../types';
import { TIER_RANKS, TIER_COLORS } from '../../types';
import { buildGraph, topologicalSort, deriveLayeredRanking } from '../../lib/graph';
import { updateTierAssignments, ensureTierList } from '../../hooks/use-tier-list';

interface Props {
  relationships: Relationship[];
  characters: Character[];
}

export function RankedList({ relationships, characters }: Props) {
  const [applied, setApplied] = useState(false);

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

    // Map graph layers to tier ranks. If more layers than tiers, compress.
    const tierAssignments: { characterId: string; tier: TierRank; position: number }[] = [];

    for (const [layerIdx, ids] of sortedLayers) {
      // Map layer index to a tier rank, clamping to available tiers
      const tierIdx = Math.min(layerIdx, TIER_RANKS.length - 1);
      const tier = TIER_RANKS[tierIdx];
      const existingInTier = tierAssignments.filter((a) => a.tier === tier).length;
      ids.forEach((id, i) => {
        if (charMap.has(id)) {
          tierAssignments.push({
            characterId: id,
            tier,
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
          const tierIdx = Math.min(layer, TIER_RANKS.length - 1);
          const tier = TIER_RANKS[tierIdx];
          return (
            <div key={layer} className="flex items-start gap-3">
              <span
                className="text-xs font-bold w-8 h-6 flex items-center justify-center rounded shrink-0"
                style={{ backgroundColor: TIER_COLORS[tier], color: '#1a1a2e' }}
              >
                {tier}
              </span>
              <div className="flex flex-wrap gap-1">
                {ids.map((id) => {
                  const char = charMap.get(id);
                  return char ? (
                    <span
                      key={id}
                      className="text-xs px-2 py-1 rounded bg-[#252550] text-gray-300 border border-gray-700"
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
          Layers are mapped to tiers S through F. Click "Apply to Tier List" to auto-place.
        </p>
      </div>
    );
  }

  return null;
}
