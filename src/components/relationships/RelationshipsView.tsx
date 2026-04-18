import { useCharacters } from '../../hooks/use-characters';
import { useRelationships } from '../../hooks/use-relationships';
import { RelationshipInput } from './RelationshipInput';
import { RelationshipList } from './RelationshipList';
import { CycleWarning } from './CycleWarning';

export function RelationshipsView() {
  const characters = useCharacters();
  const relationships = useRelationships();

  return (
    <div className="space-y-6">
      <RelationshipInput characters={characters} />
      <CycleWarning
        relationships={relationships}
        characters={characters}
      />
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
  );
}
