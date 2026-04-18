import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
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
import { TierManager } from './TierManager';
import { useCharacters } from '../../hooks/use-characters';
import { useTierList, updateTierAssignments } from '../../hooks/use-tier-list';
import { useRelationships } from '../../hooks/use-relationships';
import { findInconsistencies } from '../../lib/inconsistency-checker';
import { enforceAfterMove } from '../../lib/enforce-constraints';
import type { Character, TierAssignment } from '../../types';
import { DEFAULT_TIER_DEFS } from '../../types';

export function TierListView() {
  const characters = useCharacters();
  const tierList = useTierList();
  const relationships = useRelationships();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragStartContainer, setDragStartContainer] = useState<string | null>(null);
  // Local preview state during drag — avoids async DB writes mid-drag
  const [dragPreview, setDragPreview] = useState<TierAssignment[] | null>(null);

  const tierDefs = tierList?.tierDefs ?? DEFAULT_TIER_DEFS;
  const tierIds = useMemo(() => tierDefs.map((t) => t.id), [tierDefs]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const dbAssignments = tierList?.tiers ?? [];
  // During drag, render from local state; otherwise from DB
  const assignments = dragPreview ?? dbAssignments;

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
    const charId = event.active.id as string;
    setActiveId(charId);
    setDragStartContainer(findContainer(charId));
    // Snapshot current assignments for local editing during drag
    setDragPreview([...dbAssignments]);
  }

  function handleDragOver(event: DragOverEvent) {
    if (!dragPreview) return;
    const { active, over } = event;
    if (!over) return;

    const activeContainer = findContainer(active.id as string);
    const overContainer = getContainerFromDroppableId(over.id as string);

    if (activeContainer === overContainer) return;

    // Move between containers in LOCAL state (no DB write)
    const updated = dragPreview.filter(
      (a) => a.characterId !== (active.id as string),
    );

    if (overContainer !== 'unranked') {
      const overCharIdx = updated.findIndex(
        (a) => a.characterId === (over.id as string) && a.tier === overContainer,
      );
      const position = overCharIdx >= 0
        ? updated[overCharIdx].position
        : updated.filter((a) => a.tier === overContainer).length;

      updated.push({
        characterId: active.id as string,
        tier: overContainer,
        position,
      });
    }

    setDragPreview(updated);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const origContainer = dragStartContainer;
    setActiveId(null);
    setDragStartContainer(null);

    if (!over || !dragPreview) {
      setDragPreview(null);
      return;
    }

    const overContainer = getContainerFromDroppableId(over.id as string);

    let finalAssignments: TierAssignment[];

    if (origContainer === overContainer && origContainer !== 'unranked') {
      // Within-tier reorder
      const tier = origContainer;
      const tierCharIds = dragPreview
        .filter((a) => a.tier === tier)
        .sort((a, b) => a.position - b.position)
        .map((a) => a.characterId)
        .filter((id) => charMap.has(id));

      const oldIndex = tierCharIds.indexOf(active.id as string);
      const overIndex = tierCharIds.indexOf(over.id as string);

      if (oldIndex !== -1 && overIndex !== -1 && oldIndex !== overIndex) {
        const reordered = arrayMove(tierCharIds, oldIndex, overIndex);
        finalAssignments = dragPreview.filter((a) => a.tier !== tier);
        reordered.forEach((id, idx) => {
          finalAssignments.push({ characterId: id, tier, position: idx });
        });
      } else {
        finalAssignments = dragPreview;
      }
    } else if (overContainer === 'unranked') {
      // Drop to unranked
      finalAssignments = dragPreview.filter(
        (a) => a.characterId !== (active.id as string),
      );
    } else {
      // Cross-tier or unranked→tier — enforce constraints
      finalAssignments = enforceAfterMove(
        dbAssignments,
        relationships,
        active.id as string,
        overContainer,
        tierIds,
      );
    }

    // Show final state immediately (local), then persist to DB
    setDragPreview(finalAssignments);
    updateTierAssignments(finalAssignments);
  }

  return (
    <div>
      <InconsistencyBanner inconsistencies={inconsistencies} />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="rounded-lg overflow-hidden border border-gray-700 bg-[#141414]">
          {tierDefs.map((td) => (
            <TierRow
              key={td.id}
              tierDef={td}
              characters={getCharactersForTier(td.id)}
              characterIds={getCharacterIdsForTier(td.id)}
            />
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
      <TierManager tierDefs={tierDefs} />
    </div>
  );
}
