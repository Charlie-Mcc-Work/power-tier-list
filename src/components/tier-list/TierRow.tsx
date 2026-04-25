import { useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CharacterCard } from './CharacterCard';
import { useUIStore } from '../../stores/ui-store';
import {
  insertTierDefAt,
  recolorTierDef,
  removeTierDef,
  renameTierDef,
  reorderTierDefs,
} from '../../hooks/use-tier-list';
import type { Character, TierDefinition } from '../../types';

const TIER_PALETTE = [
  '#ff6b6b', '#ffa06b', '#ffd06b', '#d4ff6b', '#6bffa0',
  '#6bffd0', '#6bd0ff', '#6ba0ff', '#a06bff', '#ff6bd0',
  '#ff9eb8', '#c9e86b', '#6be8c9', '#b89eff', '#ff6b9e',
];

function randomColor(): string {
  return TIER_PALETTE[Math.floor(Math.random() * TIER_PALETTE.length)];
}

interface Props {
  tierDef: TierDefinition;
  characters: Character[];
  characterIds: string[];
  highlighted?: boolean;
  index: number;
  totalTiers: number;
  tierIds: string[];
  autoEdit?: boolean;
  onAutoEditHandled?: () => void;
  onInsertedTier?: (id: string) => void;
}

export function TierRow({
  tierDef,
  characters,
  characterIds,
  highlighted,
  index,
  totalTiers,
  tierIds,
  autoEdit,
  onAutoEditHandled,
  onInsertedTier,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `tier-${tierDef.id}`,
    data: { type: 'tier', tier: tierDef.id },
  });
  const showTierCounts = useUIStore((s) => s.showTierCounts);
  const showHighlight = isOver || highlighted;

  const [localEditing, setLocalEditing] = useState(false);
  const editing = localEditing || !!autoEdit;
  const [draftName, setDraftName] = useState(tierDef.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function startEdit() {
    setDraftName(tierDef.name);
    setLocalEditing(true);
  }

  async function commitRename() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== tierDef.name) {
      await renameTierDef(tierDef.id, trimmed);
    }
    setLocalEditing(false);
    if (autoEdit) onAutoEditHandled?.();
  }

  function cancelRename() {
    setDraftName(tierDef.name);
    setLocalEditing(false);
    if (autoEdit) onAutoEditHandled?.();
  }

  async function handleInsertAt(targetIdx: number) {
    const id = await insertTierDefAt(targetIdx, 'New', randomColor());
    onInsertedTier?.(id);
  }

  async function handleMoveUp() {
    if (index <= 0) return;
    const ids = [...tierIds];
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    await reorderTierDefs(ids);
  }

  async function handleMoveDown() {
    if (index >= totalTiers - 1) return;
    const ids = [...tierIds];
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    await reorderTierDefs(ids);
  }

  async function handleDelete() {
    if (totalTiers <= 1) return;
    await removeTierDef(tierDef.id);
  }

  return (
    <div
      ref={setNodeRef}
      className={`group/tier relative flex items-stretch border-b border-gray-700 min-h-[88px] transition-all duration-100 ${
        showHighlight
          ? 'ring-2 ring-inset ring-amber-400/60 bg-amber-400/8'
          : ''
      }`}
    >
      <div
        className="w-16 shrink-0 flex flex-col items-center justify-center font-bold relative"
        style={{
          backgroundColor: tierDef.color,
          color: '#141414',
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') cancelRename();
            }}
            className="w-full text-center bg-white/70 text-black text-lg font-bold px-1 rounded
                       focus:outline-none focus:ring-2 focus:ring-amber-500"
            maxLength={16}
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="text-xl leading-none cursor-text"
            title="Click to rename"
          >
            {tierDef.name}
          </button>
        )}
        {showTierCounts && !editing && (
          <span className="text-[9px] font-medium opacity-70 leading-none mt-0.5">
            {characters.length}
          </span>
        )}

        {/* Color swatch — tiny, bottom-right, shown on row hover */}
        <label
          className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-sm border border-black/30 cursor-pointer
                     opacity-0 group-hover/tier:opacity-100 transition-opacity"
          style={{ backgroundColor: tierDef.color }}
          title="Change tier color"
        >
          <input
            type="color"
            value={tierDef.color}
            onChange={(e) => recolorTierDef(tierDef.id, e.target.value)}
            className="opacity-0 w-0 h-0 absolute"
            aria-label="Tier color"
          />
        </label>
      </div>

      {/* In-row control strip — hover-revealed, sits over the left edge of the character area */}
      <div
        className="absolute left-16 top-0 bottom-0 flex flex-col items-center justify-center gap-0.5 z-10 px-0.5
                   opacity-0 group-hover/tier:opacity-100 transition-opacity
                   bg-gradient-to-r from-[#141414]/95 via-[#141414]/70 to-transparent pr-3"
      >
        <TierIconButton
          title="Insert tier above"
          onClick={() => handleInsertAt(index)}
          label="+ ▲"
        />
        <TierIconButton
          title="Move tier up"
          onClick={handleMoveUp}
          disabled={index === 0}
          label="▲"
        />
        <TierIconButton
          title={totalTiers <= 1 ? 'Can\'t delete the last tier' : 'Delete tier'}
          onClick={handleDelete}
          disabled={totalTiers <= 1}
          label="✕"
          danger
        />
        <TierIconButton
          title="Move tier down"
          onClick={handleMoveDown}
          disabled={index === totalTiers - 1}
          label="▼"
        />
        <TierIconButton
          title="Insert tier below"
          onClick={() => handleInsertAt(index + 1)}
          label="+ ▼"
        />
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

function TierIconButton({
  title,
  onClick,
  label,
  disabled,
  danger,
}: {
  title: string;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`w-5 h-5 flex items-center justify-center rounded text-[10px] leading-none
                  border border-gray-700 bg-[#1a1a1a]/90 text-gray-300
                  hover:bg-[#2a2a2a] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed
                  transition-colors ${danger ? 'hover:text-red-400 hover:border-red-700' : ''}`}
    >
      {label}
    </button>
  );
}
