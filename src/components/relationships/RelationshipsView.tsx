import { useState } from 'react';
import { useCharacters } from '../../hooks/use-characters';
import { useRelationships } from '../../hooks/use-relationships';
import { useTierList } from '../../hooks/use-tier-list';
import { RelationshipInput } from './RelationshipInput';
import { RelationshipList } from './RelationshipList';
import { CycleWarning } from './CycleWarning';
import { GraphView } from './GraphView';

export function RelationshipsView() {
  const characters = useCharacters();
  const relationships = useRelationships();
  const tierList = useTierList();
  const [showGraph, setShowGraph] = useState(false);

  return (
    <div className="space-y-6">
      <RelationshipInput characters={characters} />
      <CycleWarning
        relationships={relationships}
        characters={characters}
      />

      {/* Graph toggle */}
      {relationships.length > 0 && (
        <div>
          <button
            onClick={() => setShowGraph(!showGraph)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors mb-2"
          >
            {showGraph ? 'Hide' : 'Show'} Graph
          </button>
          {showGraph && (
            <GraphView
              relationships={relationships}
              characters={characters}
              tierList={tierList}
            />
          )}
        </div>
      )}

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
