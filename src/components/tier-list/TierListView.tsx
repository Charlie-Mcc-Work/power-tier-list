import { useState, useMemo, useCallback } from 'react';
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
import { useCharacters } from '../../hooks/use-characters';
import { useTierList, updateTierAssignments, ensureTierList } from '../../hooks/use-tier-list';
import { useRelationships } from '../../hooks/use-relationships';
import { findInconsistencies } from '../../lib/inconsistency-checker';
import type { Character, TierRank, TierAssignment } from '../../types';
import { TIER_RANKS } from '../../types';

// Initialize tier list on first render
ensureTierList();

export function TierListView() {
  const characters = useCharacters();
  const tierList = useTierList();
  const relationships = useRelationships();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const assignments = tierList?.tiers ?? [];
  const assignmentMap = useMemo(
    () => new Map(assignments.map((a) => [a.characterId, a])),
    [assignments],
  );
  const charMap = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters],
  );

  const getCharactersForTier = useCallback(
    (tier: TierRank): Character[] => {
      return assignments
        .filter((a) => a.tier === tier)
        .sort((a, b) => a.position - b.position)
        .map((a) => charMap.get(a.characterId))
        .filter((c): c is Character => c !== undefined);
    },
    [assignments, charMap],
  );

  const getCharacterIdsForTier = useCallback(
    (tier: TierRank): string[] => {
      return assignments
        .filter((a) => a.tier === tier)
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
    () => findInconsistencies(assignments, relationships, characters),
    [assignments, relationships, characters],
  );

  const activeCharacter = activeId ? charMap.get(activeId) : undefined;

  function findContainer(id: string): TierRank | 'unranked' {
    const assignment = assignmentMap.get(id);
    if (assignment) return assignment.tier;
    return 'unranked';
  }

  function getContainerFromDroppableId(id: string): TierRank | 'unranked' {
    if (id === 'unranked') return 'unranked';
    if (id.startsWith('tier-')) return id.replace('tier-', '') as TierRank;
    // It's a character id — find which container it's in
    return findContainer(id);
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeContainer = findContainer(active.id as string);
    const overContainer = getContainerFromDroppableId(over.id as string);

    if (activeContainer === overContainer) return;

    // Move to new container
    const newAssignments = assignments.filter(
      (a) => a.characterId !== (active.id as string),
    );

    if (overContainer !== 'unranked') {
      const tierItems = newAssignments.filter((a) => a.tier === overContainer);
      newAssignments.push({
        characterId: active.id as string,
        tier: overContainer,
        position: tierItems.length,
      });
    }

    updateTierAssignments(newAssignments);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeContainer = findContainer(active.id as string);
    const overContainer = getContainerFromDroppableId(over.id as string);

    if (activeContainer === overContainer && activeContainer !== 'unranked') {
      // Reorder within same tier
      const tier = activeContainer;
      const tierIds = getCharacterIdsForTier(tier);
      const oldIndex = tierIds.indexOf(active.id as string);
      const overIndex = tierIds.indexOf(over.id as string);

      if (oldIndex !== -1 && overIndex !== -1 && oldIndex !== overIndex) {
        const reordered = arrayMove(tierIds, oldIndex, overIndex);
        const newAssignments: TierAssignment[] = assignments.filter(
          (a) => a.tier !== tier,
        );
        reordered.forEach((id, idx) => {
          newAssignments.push({ characterId: id, tier, position: idx });
        });
        updateTierAssignments(newAssignments);
      }
    } else if (activeContainer !== overContainer) {
      // Already handled in dragOver, but finalize positions
      const newAssignments = assignments.filter(
        (a) => a.characterId !== (active.id as string),
      );

      if (overContainer !== 'unranked') {
        const tierItems = newAssignments.filter((a) => a.tier === overContainer);
        // Find insert position based on the item we're over
        const overIdx = tierItems.findIndex((a) => a.characterId === (over.id as string));
        const position = overIdx >= 0 ? overIdx : tierItems.length;

        newAssignments.push({
          characterId: active.id as string,
          tier: overContainer,
          position,
        });

        // Re-index positions for this tier
        const tierAssigns = newAssignments
          .filter((a) => a.tier === overContainer)
          .sort((a, b) => a.position - b.position);
        tierAssigns.forEach((a, idx) => {
          a.position = idx;
        });
      }

      updateTierAssignments(newAssignments);
    }
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
        <div className="rounded-lg overflow-hidden border border-gray-700 bg-[#0f0f23]">
          {TIER_RANKS.map((tier) => (
            <TierRow
              key={tier}
              tier={tier}
              characters={getCharactersForTier(tier)}
              characterIds={getCharacterIdsForTier(tier)}
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
    </div>
  );
}
