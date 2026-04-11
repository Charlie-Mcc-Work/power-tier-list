import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useImage } from '../../hooks/use-image';
import { useUIStore } from '../../stores/ui-store';
import type { Character } from '../../types';

interface Props {
  character: Character;
  isDragOverlay?: boolean;
}

export function CharacterCard({ character, isDragOverlay }: Props) {
  const imageUrl = useImage(character.imageId);
  const selectCharacter = useUIStore((s) => s.selectCharacter);

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
    ? {}
    : {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
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
        flex flex-col items-center gap-1 p-1.5 rounded-lg cursor-grab active:cursor-grabbing
        bg-[#1a1a3e] hover:bg-[#252550] border border-gray-700 hover:border-gray-500
        transition-colors w-[80px] shrink-0
        ${isDragOverlay ? 'shadow-2xl ring-2 ring-blue-400' : ''}
      `}
    >
      <div className="w-14 h-14 rounded overflow-hidden bg-gray-800 flex items-center justify-center">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={character.name}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <span className="text-2xl text-gray-500">?</span>
        )}
      </div>
      <span className="text-[10px] text-gray-300 text-center leading-tight truncate w-full">
        {character.name}
      </span>
    </div>
  );
}
