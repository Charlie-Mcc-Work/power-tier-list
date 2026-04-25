import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { TierRow } from './TierRow';
import { UnrankedPool } from './UnrankedPool';
import { CharacterCard } from './CharacterCard';
import { ImageUploader } from './ImageUploader';
import { InconsistencyBanner } from './InconsistencyBanner';
import { useCharacters } from '../../hooks/use-characters';
import { useTierList, updateTierAssignments } from '../../hooks/use-tier-list';
import { useRelationships } from '../../hooks/use-relationships';
import { findInconsistencies } from '../../lib/inconsistency-checker';
import { enforceAfterMove, enforceWithinTierOrder } from '../../lib/enforce-constraints';
import type { Character, TierAssignment } from '../../types';
import { DEFAULT_TIER_DEFS } from '../../types';
import { log } from '../../lib/logger';
import { undoManager } from '../../lib/undo';

export function TierListView() {
  const characters = useCharacters();
  const tierList = useTierList();
  const relationships = useRelationships();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [blockMessage, setBlockMessage] = useState<string | null>(null);
  const [dragStartContainer, setDragStartContainer] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<TierAssignment[] | null>(null);
  const [hoveredTierId, setHoveredTierId] = useState<string | null>(null);
  const [autoEditTierId, setAutoEditTierId] = useState<string | null>(null);
  const dragOverBusy = useRef(false);
  const viewRef = useRef<HTMLDivElement>(null);

  const tierDefs = tierList?.tierDefs ?? DEFAULT_TIER_DEFS;
  const tierIds = useMemo(() => tierDefs.map((t) => t.id), [tierDefs]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  );

  // Memoize so `?? []` doesn't return a fresh empty array each render
  // (which would destabilize any useEffect/useMemo that depends on it).
  const dbAssignments = useMemo(() => tierList?.tiers ?? [], [tierList?.tiers]);
  const assignments = dragPreview ?? dbAssignments;

  // Track which tier the pointer is physically over during drag (for highlighting)
  // and enable mousewheel scrolling during drag
  useEffect(() => {
    if (!activeId) {
      setHoveredTierId(null);
      return;
    }

    // Find scrollable ancestor for wheel forwarding
    let scrollParent: HTMLElement | null = viewRef.current;
    while (scrollParent && scrollParent.scrollHeight <= scrollParent.clientHeight) {
      scrollParent = scrollParent.parentElement;
    }

    function handlePointerMove(e: PointerEvent) {
      if (!viewRef.current) return;
      const tierContainer = viewRef.current.querySelector('[data-tier-container]');
      if (!tierContainer) return;

      for (const child of tierContainer.children) {
        const rect = child.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          const tierId = child.getAttribute('data-tier-id');
          if (tierId) {
            setHoveredTierId(tierId);
            return;
          }
        }
      }
      setHoveredTierId(null);
    }

    function handleWheel(e: WheelEvent) {
      if (scrollParent) {
        scrollParent.scrollTop += e.deltaY;
      }
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [activeId]);

  // Undo/redo keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const restored = undoManager.undo(dbAssignments);
        if (restored) updateTierAssignments(restored);
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        const restored = undoManager.redo(dbAssignments);
        if (restored) updateTierAssignments(restored);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [dbAssignments]);

  // Clear local preview once DB catches up after drop
  useEffect(() => {
    if (dragPreview && !activeId) {
      setDragPreview(null);
    }
  }, [tierList, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const assignmentMap = useMemo(
    () => new Map(assignments.map((a) => [a.characterId, a])),
    [assignments],
  );
  const charMap = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters],
  );

  const getCharactersForTier = useCallback(
    (tierId: string): Character[] => {
      return assignments
        .filter((a) => a.tier === tierId)
        .sort((a, b) => a.position - b.position)
        .map((a) => charMap.get(a.characterId))
        .filter((c): c is Character => c !== undefined);
    },
    [assignments, charMap],
  );

  const getCharacterIdsForTier = useCallback(
    (tierId: string): string[] => {
      return assignments
        .filter((a) => a.tier === tierId)
        .sort((a, b) => a.position - b.position)
        .map((a) => a.characterId)
        .filter((id) => charMap.has(id));
    },
    [assignments, charMap],
  );

  const unrankedCharacters = useMemo(
    () => characters.filter((c) => !assignmentMap.has(c.id)),
    [characters, assignmentMap],
  );

  const unrankedIds = useMemo(
    () => unrankedCharacters.map((c) => c.id),
    [unrankedCharacters],
  );

  const inconsistencies = useMemo(
    () => findInconsistencies(dbAssignments, relationships, characters, tierIds),
    [dbAssignments, relationships, characters, tierIds],
  );

  const activeCharacter = activeId ? charMap.get(activeId) : undefined;

  function findContainer(id: string): string {
    const assignment = assignmentMap.get(id);
    if (assignment) return assignment.tier;
    return 'unranked';
  }

  function getContainerFromDroppableId(id: string): string {
    if (id === 'unranked') return 'unranked';
    if (id.startsWith('tier-')) return id.slice(5);
    return findContainer(id);
  }

  function handleDragStart(event: DragStartEvent) {
    try {
      const charId = event.active.id as string;
      const container = findContainer(charId);
      log.info('drag', `start: ${charMap.get(charId)?.name ?? charId} from ${container}`);
      setActiveId(charId);
      setDragStartContainer(container);
      setDragPreview([...dbAssignments]);
    } catch (err) {
      log.error('drag', 'dragStart crashed', { error: String(err), stack: (err as Error)?.stack });
      setActiveId(null);
      setDragPreview(null);
    }
  }

  function handleDragOver(event: DragOverEvent) {
    if (dragOverBusy.current || !dragPreview) return;
    const { active, over } = event;
    if (!over) return;

    try {
      dragOverBusy.current = true;

      const activeContainer = findContainer(active.id as string);
      const overContainer = getContainerFromDroppableId(over.id as string);

      if (activeContainer === overContainer) return;

      log.info('drag', `over: ${activeContainer} → ${overContainer}`);

      const updated = dragPreview.filter(
        (a) => a.characterId !== (active.id as string),
      );

      if (overContainer !== 'unranked') {
        const tierItems = updated.filter((a) => a.tier === overContainer);
        updated.push({
          characterId: active.id as string,
          tier: overContainer,
          position: tierItems.length,
        });
      }

      setDragPreview(updated);
    } catch (err) {
      log.error('drag', 'dragOver crashed', { error: String(err), stack: (err as Error)?.stack, activeId: active.id, overId: over.id });
    } finally {
      dragOverBusy.current = false;
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const origContainer = dragStartContainer;
    setActiveId(null);
    setDragStartContainer(null);

    if (!over || !dragPreview) {
      log.info('drag', 'end: cancelled (no target or no preview)');
      setDragPreview(null);
      return;
    }

    try {
      const overContainer = getContainerFromDroppableId(over.id as string);
      const charName = charMap.get(active.id as string)?.name ?? active.id;
      log.info('drag', `end: ${charName} from ${origContainer} → ${overContainer}`);

      let finalAssignments: TierAssignment[];

      if (origContainer === overContainer && origContainer !== 'unranked') {
        const tier = origContainer;
        const tierCharIds = dragPreview
          .filter((a) => a.tier === tier)
          .sort((a, b) => a.position - b.position)
          .map((a) => a.characterId)
          .filter((id) => charMap.has(id));

        const oldIndex = tierCharIds.indexOf(active.id as string);
        const overIndex = tierCharIds.indexOf(over.id as string);

        if (oldIndex !== -1 && overIndex !== -1 && oldIndex !== overIndex) {
          log.info('drag', `reorder within ${tier}: idx ${oldIndex} → ${overIndex}`);
          const reordered = arrayMove(tierCharIds, oldIndex, overIndex);
          finalAssignments = dragPreview.filter((a) => a.tier !== tier);
          reordered.forEach((id, idx) => {
            finalAssignments.push({ characterId: id, tier, position: idx });
          });
          finalAssignments = enforceWithinTierOrder(finalAssignments, relationships);
        } else {
          finalAssignments = dragPreview;
        }
      } else if (overContainer === 'unranked') {
        log.info('drag', `${charName} → unranked`);
        finalAssignments = dragPreview.filter(
          (a) => a.characterId !== (active.id as string),
        );
      } else {
        const charNames = new Map(characters.map((c) => [c.id, c.name]));
        const result = enforceAfterMove(
          dbAssignments,
          relationships,
          active.id as string,
          overContainer,
          tierIds,
          charNames,
        );

        if (!result.ok) {
          log.warn('drag', `blocked: ${result.reason}`);
          setDragPreview(null);
          setBlockMessage(result.reason);
          setTimeout(() => setBlockMessage(null), 4000);
          return;
        }

        log.info('drag', `enforced: ${result.assignments.length} assignments`);
        finalAssignments = result.assignments;
      }

      // Save state for undo before committing
      undoManager.push(dbAssignments, 'drag');
      setDragPreview(finalAssignments);
      updateTierAssignments(finalAssignments);
    } catch (err) {
      log.error('drag', 'dragEnd crashed', { error: String(err), stack: (err as Error)?.stack, activeId: active.id, overId: over.id, origContainer });
      setDragPreview(null);
    }
  }

  return (
    <div ref={viewRef}>
      {blockMessage && (
        <div className="mb-3 rounded-lg border border-red-600/50 bg-red-900/20 px-4 py-2.5 flex items-center gap-3">
          <span className="text-red-400 text-sm font-medium shrink-0">Move blocked</span>
          <span className="text-red-300/80 text-xs">{blockMessage}</span>
          <button
            onClick={() => setBlockMessage(null)}
            className="ml-auto text-red-400/60 hover:text-red-300 text-xs shrink-0"
          >
            x
          </button>
        </div>
      )}
      <InconsistencyBanner inconsistencies={inconsistencies} />

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div data-tier-container className="rounded-lg overflow-hidden border border-gray-700 bg-[#141414]">
          {tierDefs.map((td, idx) => (
            <div key={td.id} data-tier-id={td.id}>
              <TierRow
                tierDef={td}
                characters={getCharactersForTier(td.id)}
                characterIds={getCharacterIdsForTier(td.id)}
                highlighted={hoveredTierId === td.id && activeId != null}
                index={idx}
                totalTiers={tierDefs.length}
                tierIds={tierIds}
                autoEdit={autoEditTierId === td.id}
                onAutoEditHandled={() => setAutoEditTierId(null)}
                onInsertedTier={(newId) => setAutoEditTierId(newId)}
              />
            </div>
          ))}
        </div>

        <UnrankedPool
          characters={unrankedCharacters}
          characterIds={unrankedIds}
        />

        <DragOverlay>
          {activeCharacter ? (
            <CharacterCard character={activeCharacter} isDragOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>

      <ImageUploader />
    </div>
  );
}
