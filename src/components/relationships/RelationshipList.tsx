import type { Relationship, Character } from '../../types';
import { deleteRelationship, updateRelationshipStrict } from '../../hooks/use-relationships';

interface Props {
  relationships: Relationship[];
  characters: Character[];
}

export function RelationshipList({ relationships, characters }: Props) {
  const charMap = new Map(characters.map((c) => [c.id, c]));

  if (relationships.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4">
        No relationships yet. Add one above.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {relationships.map((rel) => {
        const superior = charMap.get(rel.superiorId);
        const inferior = charMap.get(rel.inferiorId);
        if (!superior || !inferior) return null;

        const isStrict = rel.strict ?? false;

        return (
          <div
            key={rel.id}
            className="flex items-center gap-3 p-2 rounded bg-[#1a1a3e] border border-gray-700"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-white font-medium truncate">{superior.name}</span>
                <button
                  onClick={() => updateRelationshipStrict(rel.id, !isStrict)}
                  className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-mono border transition-colors cursor-pointer ${
                    isStrict
                      ? 'text-orange-400 bg-orange-900/20 border-orange-700/50 hover:bg-orange-900/40'
                      : 'text-blue-400 bg-blue-900/20 border-blue-700/50 hover:bg-blue-900/40'
                  }`}
                  title={isStrict ? 'Strictly higher tier (click to toggle)' : 'Same tier or higher (click to toggle)'}
                >
                  {isStrict ? '>' : '>='}
                </button>
                <span className="text-white font-medium truncate">{inferior.name}</span>
              </div>
              {rel.note && (
                <p className="text-[10px] text-gray-500 italic truncate mt-0.5">{rel.note}</p>
              )}
            </div>
            <button
              onClick={() => deleteRelationship(rel.id)}
              className="text-gray-500 hover:text-red-400 text-xs transition-colors shrink-0"
              title="Delete relationship"
            >
              x
            </button>
          </div>
        );
      })}
    </div>
  );
}
