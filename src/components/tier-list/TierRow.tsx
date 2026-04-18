import { useDroppable } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CharacterCard } from './CharacterCard';
import type { Character, TierRank } from '../../types';
import { TIER_COLORS } from '../../types';

interface Props {
  tier: TierRank;
  characters: Character[];
  characterIds: string[];
}

export function TierRow({ tier, characters, characterIds }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `tier-${tier}`,
    data: { type: 'tier', tier },
  });

  return (
    <div
      className={`flex items-stretch border-b border-gray-700 min-h-[88px] transition-colors ${
        isOver ? 'bg-[#252525]' : ''
      }`}
    >
      <div
        className="w-16 shrink-0 flex items-center justify-center font-bold text-xl text-gray-900"
        style={{ backgroundColor: TIER_COLORS[tier] }}
      >
        {tier}
      </div>
      <SortableContext
        items={characterIds}
        strategy={horizontalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className="flex-1 flex items-center gap-2 p-2 flex-wrap min-h-[88px]"
        >
          {characters.map((char) => (
            <CharacterCard key={char.id} character={char} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
