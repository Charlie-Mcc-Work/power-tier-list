import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useImage } from '../../hooks/use-image';
import { useUIStore, CARD_SIZES, cardHeightEstimate } from '../../stores/ui-store';
import type { Character } from '../../types';

interface Props {
  character: Character;
  isDragOverlay?: boolean;
  /** Optional delete callback. When provided, a small hover-only × button appears. */
  onDelete?: (character: Character) => void;
  /** When true, clicking the card toggles selection instead of opening details, and drag is disabled. */
  selectMode?: boolean;
  /** Whether this card is currently selected in bulk-select mode. */
  selected?: boolean;
  /** Fired when the card is clicked in select mode. */
  onToggleSelect?: (character: Character) => void;
  /**
   * Whether the card should be visually dimmed because it doesn't match the
   * current search. Computed by the parent (which subscribes to searchQuery
   * once) so a keystroke doesn't re-render every card via memo.
   */
  dim?: boolean;
}

export const CharacterCard = memo(function CharacterCard({
  character,
  isDragOverlay,
  onDelete,
  selectMode,
  selected,
  onToggleSelect,
  dim,
}: Props) {
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

  const style: React.CSSProperties = isDragOverlay
    ? { width: sizes.card }
    : {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        width: sizes.card,
        // Skip layout/paint for off-screen cards. With 1k+ cards in one
        // scrollable container, this is the cheapest way to keep scroll
        // responsive without true virtualization.
        contentVisibility: isDragOverlay ? undefined : 'auto',
        containIntrinsicSize: `${sizes.card}px ${cardHeightEstimate(cardSize)}px`,
      };

  // In select mode we drop drag listeners and swap click behavior — the card
  // becomes a checkbox-like control instead of a draggable item.
  const dragProps = isDragOverlay || selectMode
    ? {}
    : { ...attributes, ...listeners };

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (selectMode) {
      onToggleSelect?.(character);
    } else {
      selectCharacter(character.id);
    }
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    onDelete?.(character);
  }

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={style}
      {...dragProps}
      onClick={handleClick}
      className={`
        relative group flex flex-col items-center gap-0.5 p-1 rounded-lg
        bg-[#1e1e1e] hover:bg-[#2a2a2a] border transition-all shrink-0
        ${selectMode
          ? selected
            ? 'border-amber-400 ring-2 ring-amber-400 cursor-pointer'
            : 'border-gray-700 hover:border-gray-500 cursor-pointer'
          : 'border-gray-700 hover:border-gray-500 cursor-grab active:cursor-grabbing'}
        ${isDragOverlay ? 'shadow-2xl ring-2 ring-amber-400' : ''}
        ${dim ? 'opacity-15 scale-90' : ''}
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

      {/* Selection checkmark overlay (select mode) */}
      {selectMode && (
        <div
          className={`absolute top-1 left-1 w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold ${
            selected ? 'bg-amber-400 border-amber-400 text-black' : 'bg-[#141414]/90 border-gray-500 text-transparent'
          }`}
          aria-hidden
        >
          ✓
        </div>
      )}

      {/* Hover × delete (single-card delete; suppressed in select mode) */}
      {onDelete && !selectMode && !isDragOverlay && (
        <button
          type="button"
          onClick={handleDeleteClick}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-600 text-white text-[11px] leading-none
                     flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100
                     hover:bg-red-500 transition-opacity"
          title={`Delete "${character.name}"`}
          aria-label={`Delete ${character.name}`}
        >
          ×
        </button>
      )}
    </div>
  );
});
