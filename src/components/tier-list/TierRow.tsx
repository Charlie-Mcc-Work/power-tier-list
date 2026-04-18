import { useDroppable } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CharacterCard } from './CharacterCard';
import { useUIStore } from '../../stores/ui-store';
import type { Character, TierDefinition } from '../../types';

interface Props {
  tierDef: TierDefinition;
  characters: Character[];
  characterIds: string[];
  highlighted?: boolean;
}

export function TierRow({ tierDef, characters, characterIds, highlighted }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `tier-${tierDef.id}`,
    data: { type: 'tier', tier: tierDef.id },
  });
  const showTierCounts = useUIStore((s) => s.showTierCounts);
  const showHighlight = isOver || highlighted;

  return (
    <div
      ref={setNodeRef}
      className={`flex items-stretch border-b border-gray-700 min-h-[88px] transition-all duration-100 ${
        showHighlight
          ? 'ring-2 ring-inset ring-amber-400/60 bg-amber-400/8'
          : ''
      }`}
    >
      <div
        className="w-16 shrink-0 flex flex-col items-center justify-center font-bold"
        style={{
          backgroundColor: tierDef.color,
          color: '#141414',
        }}
      >
        <span className="text-xl leading-none">{tierDef.name}</span>
        {showTierCounts && (
          <span className="text-[9px] font-medium opacity-70 leading-none mt-0.5">
            {characters.length}
          </span>
        )}
      </div>
      <SortableContext
        items={characterIds}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex-1 flex items-center gap-2 p-2 flex-wrap min-h-[88px]">
          {characters.map((char) => (
            <CharacterCard key={char.id} character={char} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
