import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CharacterCard } from './CharacterCard';
import { deleteCharacter, deleteCharacters } from '../../hooks/use-characters';
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

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function toggleSelect(char: Character) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(char.id)) next.delete(char.id);
      else next.add(char.id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(characters.map((c) => c.id)));
  }

  async function handleDeleteOne(char: Character) {
    if (busy) return;
    if (!window.confirm(`Delete "${char.name}"? Restorable via Backups.`)) return;
    setBusy(true);
    try {
      await deleteCharacter(char.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSelected() {
    if (busy || selected.size === 0) return;
    const count = selected.size;
    if (!window.confirm(
      `Delete ${count} character${count === 1 ? '' : 's'}? This also removes any relationships involving them. Restorable via Backups.`,
    )) return;
    setBusy(true);
    try {
      await deleteCharacters([...selected]);
      exitSelectMode();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-400">
          Unranked ({characters.length})
          {selectMode && selected.size > 0 && (
            <span className="ml-2 text-amber-400">· {selected.size} selected</span>
          )}
        </h3>
        {characters.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            {selectMode ? (
              <>
                <button
                  onClick={selectAll}
                  disabled={busy}
                  className="text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
                  type="button"
                >
                  Select all
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  disabled={busy || selected.size === 0}
                  className="text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40"
                  type="button"
                >
                  Clear
                </button>
                <button
                  onClick={handleDeleteSelected}
                  disabled={busy || selected.size === 0}
                  className="px-2 py-1 rounded bg-red-900/40 text-red-300 border border-red-700/50
                             hover:bg-red-900/70 disabled:opacity-40 transition-colors"
                  type="button"
                >
                  {busy ? 'Deleting…' : `Delete ${selected.size}`}
                </button>
                <button
                  onClick={exitSelectMode}
                  disabled={busy}
                  className="text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
                  type="button"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setSelectMode(true)}
                className="text-gray-400 hover:text-gray-200 transition-colors"
                type="button"
                title="Enter bulk-delete mode"
              >
                Select to delete…
              </button>
            )}
          </div>
        )}
      </div>

      <SortableContext
        items={characterIds}
        strategy={horizontalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={`flex items-center gap-2 p-3 flex-wrap min-h-[88px] rounded-lg border-2 border-dashed transition-colors ${
            isOver
              ? 'border-amber-400 bg-amber-400/10'
              : 'border-gray-700 bg-[#141414]'
          }`}
        >
          {characters.length === 0 && (
            <span className="text-gray-500 text-sm">
              Upload characters or drag them here to unrank
            </span>
          )}
          {characters.map((char) => (
            <CharacterCard
              key={char.id}
              character={char}
              onDelete={handleDeleteOne}
              selectMode={selectMode}
              selected={selected.has(char.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
