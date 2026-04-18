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
import { TierManager } from './TierManager';
import { useCharacters } from '../../hooks/use-characters';
import { useTierList, updateTierAssignments, ensureTierList } from '../../hooks/use-tier-list';
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

  const tierDefs = tierList?.tierDefs ?? DEFAULT_TIER_DEFS;
  const tierIds = useMemo(() => tierDefs.map((t) => t.id), [tierDefs]);

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
    () => findInconsistencies(assignments, relationships, characters, tierIds),
    [assignments, relationships, characters, tierIds],
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
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeContainer = findContainer(active.id as string);
    const overContainer = getContainerFromDroppableId(over.id as string);

    if (activeContainer === overContainer) return;

    // Simple visual move (no enforcement yet — that happens on drop)
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
    const origContainer = dragStartContainer;
    setActiveId(null);
    setDragStartContainer(null);
    if (!over) return;

    const overContainer = getContainerFromDroppableId(over.id as string);
    const currentContainer = findContainer(active.id as string);
    const wasCrossTier = origContainer !== currentContainer || origContainer !== overContainer;

    if (!wasCrossTier && currentContainer !== 'unranked') {
      // Reorder within same tier
      const tier = currentContainer;
      const tierCharIds = getCharacterIdsForTier(tier);
      const oldIndex = tierCharIds.indexOf(active.id as string);
      const overIndex = tierCharIds.indexOf(over.id as string);

      if (oldIndex !== -1 && overIndex !== -1 && oldIndex !== overIndex) {
        const reordered = arrayMove(tierCharIds, oldIndex, overIndex);
        const newAssignments: TierAssignment[] = assignments.filter(
          (a) => a.tier !== tier,
        );
        reordered.forEach((id, idx) => {
          newAssignments.push({ characterId: id, tier, position: idx });
        });
        updateTierAssignments(newAssignments);
      }
    } else if (overContainer === 'unranked' || currentContainer === 'unranked') {
      // Moving to/from unranked — no enforcement needed
      if (overContainer === 'unranked') {
        const newAssignments = assignments.filter(
          (a) => a.characterId !== (active.id as string),
        );
        updateTierAssignments(newAssignments);
      }
      // Moving FROM unranked to a tier is already handled by handleDragOver
    } else {
      // Cross-tier move — enforce constraints!
      const targetTier = currentContainer;
      const enforced = enforceAfterMove(
        assignments,
        relationships,
        active.id as string,
        targetTier,
        tierIds,
      );
      updateTierAssignments(enforced);
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
