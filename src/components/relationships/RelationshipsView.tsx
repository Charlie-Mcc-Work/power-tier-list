import { useCharacters } from '../../hooks/use-characters';
import { useRelationships } from '../../hooks/use-relationships';
import { RelationshipInput } from './RelationshipInput';
import { RelationshipList } from './RelationshipList';
import { RankedList } from './RankedList';
import { CycleWarning } from './CycleWarning';

export function RelationshipsView() {
  const characters = useCharacters();
  const relationships = useRelationships();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <RelationshipInput characters={characters} />
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-2">
            Relationships ({relationships.length})
          </h3>
          <RelationshipList
            relationships={relationships}
            characters={characters}
          />
        </div>
      </div>
      <div className="space-y-6">
        <CycleWarning
          relationships={relationships}
          characters={characters}
        />
        <RankedList
          relationships={relationships}
          characters={characters}
        />
      </div>
    </div>
  );
}
