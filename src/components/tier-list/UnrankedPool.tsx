import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CharacterCard } from './CharacterCard';
import { deleteCharacter, deleteCharacters } from '../../hooks/use-characters';
import { useUIStore, CARD_SIZES, cardHeightEstimate } from '../../stores/ui-store';
import type { Character } from '../../types';

interface Props {
  characters: Character[];
  characterIds: string[];
}

// Below this size, mount everything — virtualization overhead isn't worth it.
const VIRTUALIZE_THRESHOLD = 80;

function findScrollParent(el: HTMLElement | null): HTMLElement {
  let n: HTMLElement | null = el?.parentElement ?? null;
  while (n) {
    const s = getComputedStyle(n);
    if (s.overflowY === 'auto' || s.overflowY === 'scroll') return n;
    n = n.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

export function UnrankedPool({ characters, characterIds }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'unranked',
    data: { type: 'unranked' },
  });

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const searchQuery = useUIStore((s) => s.searchQuery);
  const searchLower = searchQuery.toLowerCase();
  const cardSize = useUIStore((s) => s.cardSize);
  const sizes = CARD_SIZES[cardSize];

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  // Stable identities — these are props of memoized CharacterCards; fresh
  // functions per render would make every visible card re-render on each
  // virtualizer scroll frame.
  const toggleSelect = useCallback((char: Character) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(char.id)) next.delete(char.id);
      else next.add(char.id);
      return next;
    });
  }, []);

  function selectAll() {
    setSelected(new Set(characters.map((c) => c.id)));
  }

  const busyRef = useRef(false);
  const handleDeleteOne = useCallback(async (char: Character) => {
    if (busyRef.current) return;
    if (!window.confirm(`Delete "${char.name}"? Restorable via Backups.`)) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await deleteCharacter(char.id);
    } catch (err) {
      window.alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

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
    } catch (err) {
      window.alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  // --- Virtualization setup ---------------------------------------------
  // Cards are a fixed width per size preset, so we can lay them out as a
  // regular grid and virtualize by row. The scroll container is whichever
  // ancestor has overflow-y auto (varies by layout mode), so we walk up
  // from our wrapper on mount.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [widthKnown, setWidthKnown] = useState(false);

  // Defer mounting cards until the wrapper width is known — otherwise the
  // first render would mount all N cards (virtualization disabled at
  // width=0), paying the full mount cost before the layout effect fires.
  // Empty wrapper renders first, then we measure pre-paint, then real cards.
  useLayoutEffect(() => {
    if (!wrapperRef.current) return;
    setContainerWidth(wrapperRef.current.clientWidth);
    setWidthKnown(true);
  }, []);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const parent = findScrollParent(wrapperRef.current);
    setScrollParent(parent);

    const wrapperEl = wrapperRef.current;
    const widthRO = new ResizeObserver(([entry]) => {
      // clientWidth, not contentRect.width: the initial measurement uses
      // clientWidth (padding included) and the column math subtracts padding
      // itself — mixing the two bases double-subtracts the padding.
      setContainerWidth((entry.target as HTMLElement).clientWidth);
    });
    widthRO.observe(wrapperEl);

    function updateMargin() {
      if (!wrapperRef.current) return;
      const wrapperTop = wrapperRef.current.getBoundingClientRect().top;
      const parentTop = parent.getBoundingClientRect().top;
      setScrollMargin(wrapperTop - parentTop + parent.scrollTop);
    }
    updateMargin();
    const marginRO = new ResizeObserver(updateMargin);
    marginRO.observe(parent);
    marginRO.observe(wrapperEl);
    // Content above the pool (banners appearing, tier rows wrapping) shifts
    // our offset without resizing the scroll parent or the wrapper — observe
    // the scroll parent's content element so those shifts re-measure too.
    if (parent.firstElementChild) marginRO.observe(parent.firstElementChild);

    return () => {
      widthRO.disconnect();
      marginRO.disconnect();
    };
  }, []);

  const gap = 8;
  const padX = 12;
  const cardH = cardHeightEstimate(cardSize);
  const rowH = cardH + gap;
  const cardW = sizes.card + gap;
  const columns = useMemo(
    () => Math.max(1, Math.floor((containerWidth - padX * 2 + gap) / cardW)),
    [containerWidth, cardW],
  );
  const useVirtual = characters.length >= VIRTUALIZE_THRESHOLD && containerWidth > 0;
  const rowCount = useVirtual ? Math.ceil(characters.length / columns) : 0;

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollParent,
    estimateSize: () => rowH,
    overscan: 4,
    scrollMargin,
  });

  // react-virtual caches measured sizes; switching card size (XS↔L) changes
  // rowH and needs an explicit re-measure or row offsets go stale.
  useEffect(() => {
    virtualizer.measure();
  }, [rowH, virtualizer]);

  function renderCard(char: Character) {
    return (
      <CharacterCard
        key={char.id}
        character={char}
        onDelete={handleDeleteOne}
        selectMode={selectMode}
        selected={selected.has(char.id)}
        onToggleSelect={toggleSelect}
        dim={searchLower !== '' && !char.name.toLowerCase().includes(searchLower)}
      />
    );
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
          ref={(node) => {
            wrapperRef.current = node;
            setNodeRef(node);
          }}
          className={`p-3 min-h-[88px] rounded-lg border-2 border-dashed transition-colors ${
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
          {widthKnown && characters.length > 0 && !useVirtual && (
            <div className="flex items-center gap-2 flex-wrap">
              {characters.map(renderCard)}
            </div>
          )}
          {widthKnown && useVirtual && (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: 'relative',
                width: '100%',
              }}
            >
              {virtualizer.getVirtualItems().map((vRow) => {
                const startIdx = vRow.index * columns;
                const endIdx = Math.min(startIdx + columns, characters.length);
                const rowChars = characters.slice(startIdx, endIdx);
                return (
                  <div
                    key={vRow.key}
                    style={{
                      position: 'absolute',
                      top: vRow.start - virtualizer.options.scrollMargin,
                      left: 0,
                      right: 0,
                      height: rowH,
                      display: 'flex',
                      gap: `${gap}px`,
                      alignItems: 'center',
                    }}
                  >
                    {rowChars.map(renderCard)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}
