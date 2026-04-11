import { useDroppable } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CharacterCard } from './CharacterCard';
import type { Character } from '../../types';

interface Props {
  characters: Character[];
  characterIds: string[];
}

export function UnrankedPool({ characters, characterIds }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'unranked',
    data: { type: 'unranked' },
  });

  return (
    <div className="mt-4">
      <h3 className="text-sm font-medium text-gray-400 mb-2">Unranked</h3>
      <SortableContext
        items={characterIds}
        strategy={horizontalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={`flex items-center gap-2 p-3 flex-wrap min-h-[88px] rounded-lg border-2 border-dashed transition-colors ${
            isOver
              ? 'border-blue-400 bg-blue-400/10'
              : 'border-gray-700 bg-[#0f0f23]'
          }`}
        >
          {characters.length === 0 && (
            <span className="text-gray-500 text-sm">
              Upload characters or drag them here to unrank
            </span>
          )}
          {characters.map((char) => (
            <CharacterCard key={char.id} character={char} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
