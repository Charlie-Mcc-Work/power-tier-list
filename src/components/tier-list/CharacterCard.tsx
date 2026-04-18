import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useImage } from '../../hooks/use-image';
import { useUIStore, CARD_SIZES } from '../../stores/ui-store';
import type { Character } from '../../types';

interface Props {
  character: Character;
  isDragOverlay?: boolean;
}

export const CharacterCard = memo(function CharacterCard({ character, isDragOverlay }: Props) {
  const imageUrl = useImage(character.imageId);
  const selectCharacter = useUIStore((s) => s.selectCharacter);
  const imageDisplay = useUIStore((s) => s.imageDisplay);
  const cardSize = useUIStore((s) => s.cardSize);
  const sizes = CARD_SIZES[cardSize];

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: character.id,
    data: { type: 'character', character },
  });

  const style = isDragOverlay
    ? { width: sizes.card }
    : {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        width: sizes.card,
      };

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={style}
      {...(isDragOverlay ? {} : attributes)}
      {...(isDragOverlay ? {} : listeners)}
      onClick={(e) => {
        e.stopPropagation();
        selectCharacter(character.id);
      }}
      className={`
        flex flex-col items-center gap-0.5 p-1 rounded-lg cursor-grab active:cursor-grabbing
        bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-gray-700 hover:border-gray-500
        transition-colors shrink-0
        ${isDragOverlay ? 'shadow-2xl ring-2 ring-amber-400' : ''}
      `}
    >
      <div
        className="rounded overflow-hidden bg-gray-800 flex items-center justify-center"
        style={{ width: sizes.img, height: sizes.img }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={character.name}
            className={`w-full h-full ${imageDisplay === 'contain' ? 'object-contain' : 'object-cover'}`}
            draggable={false}
          />
        ) : (
          <span className="text-gray-500" style={{ fontSize: sizes.img * 0.4 }}>?</span>
        )}
      </div>
      <span
        className="text-gray-300 text-center leading-tight truncate w-full"
        style={{ fontSize: sizes.text }}
      >
        {character.name}
      </span>
    </div>
  );
});
