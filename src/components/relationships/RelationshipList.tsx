import type { Relationship, Character, Confidence } from '../../types';
import { deleteRelationship, updateRelationshipConfidence } from '../../hooks/use-relationships';

interface Props {
  relationships: Relationship[];
  characters: Character[];
}

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  certain: 'Certain',
  likely: 'Likely',
  speculative: 'Speculative',
};

const CONFIDENCE_COLORS: Record<Confidence, string> = {
  certain: 'text-green-400 bg-green-900/30 border-green-700/50',
  likely: 'text-blue-400 bg-blue-900/30 border-blue-700/50',
  speculative: 'text-yellow-400 bg-yellow-900/30 border-yellow-700/50',
};

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

        return (
          <div
            key={rel.id}
            className="flex items-center gap-3 p-2 rounded bg-[#1a1a3e] border border-gray-700"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-white font-medium truncate">{superior.name}</span>
                <span className="text-gray-400 shrink-0">&gt;</span>
                <span className="text-white font-medium truncate">{inferior.name}</span>
              </div>
              {rel.note && (
                <p className="text-[10px] text-gray-500 italic truncate mt-0.5">{rel.note}</p>
              )}
            </div>
            <select
              value={rel.confidence}
              onChange={(e) =>
                updateRelationshipConfidence(rel.id, e.target.value as Confidence)
              }
              className={`text-xs px-2 py-0.5 rounded border cursor-pointer ${CONFIDENCE_COLORS[rel.confidence]} bg-transparent`}
            >
              {Object.entries(CONFIDENCE_LABELS).map(([value, label]) => (
                <option key={value} value={value} className="bg-[#1a1a3e] text-white">
                  {label}
                </option>
              ))}
            </select>
            <button
              onClick={() => deleteRelationship(rel.id)}
              className="text-gray-500 hover:text-red-400 text-xs transition-colors"
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
