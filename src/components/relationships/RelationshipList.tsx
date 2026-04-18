import type { Relationship, Character } from '../../types';
import { deleteRelationship, updateRelationshipStrict } from '../../hooks/use-relationships';
import { db } from '../../db/database';

interface Props {
  relationships: Relationship[];
  characters: Character[];
}

interface DisplayRow {
  type: 'directional' | 'equality';
  rel: Relationship;
  reverseRel?: Relationship; // for equality pairs
}

function buildDisplayRows(relationships: Relationship[]): DisplayRow[] {
  // Find bidirectional non-strict pairs (A >= B AND B >= A) → show as "A = B"
  const byPair = new Map<string, Relationship>();
  for (const rel of relationships) {
    byPair.set(`${rel.superiorId}->${rel.inferiorId}`, rel);
  }

  const consumed = new Set<string>();
  const rows: DisplayRow[] = [];

  for (const rel of relationships) {
    if (consumed.has(rel.id)) continue;

    const reverseKey = `${rel.inferiorId}->${rel.superiorId}`;
    const reverse = byPair.get(reverseKey);

    if (reverse && !consumed.has(reverse.id) && !(rel.strict ?? false) && !(reverse.strict ?? false)) {
      // Bidirectional non-strict = equality
      consumed.add(rel.id);
      consumed.add(reverse.id);
      rows.push({ type: 'equality', rel, reverseRel: reverse });
    } else {
      consumed.add(rel.id);
      rows.push({ type: 'directional', rel });
    }
  }

  return rows;
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

  const rows = buildDisplayRows(relationships);

  async function handleDeleteEquality(rel: Relationship, reverseRel: Relationship) {
    await db.transaction('rw', db.relationships, async () => {
      await deleteRelationship(rel.id);
      await deleteRelationship(reverseRel.id);
    });
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        if (row.type === 'equality') {
          const a = charMap.get(row.rel.superiorId);
          const b = charMap.get(row.rel.inferiorId);
          if (!a || !b) return null;

          return (
            <div
              key={row.rel.id}
              className="flex items-center gap-3 p-2 rounded bg-[#1e1e1e] border border-gray-700"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-white font-medium truncate">{a.name}</span>
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-xs font-mono border
                                   text-green-400 bg-green-900/20 border-green-700/50">
                    =
                  </span>
                  <span className="text-white font-medium truncate">{b.name}</span>
                </div>
                {row.rel.note && (
                  <p className="text-[10px] text-gray-500 italic truncate mt-0.5">{row.rel.note}</p>
                )}
              </div>
              <button
                onClick={() => handleDeleteEquality(row.rel, row.reverseRel!)}
                className="text-gray-500 hover:text-red-400 text-xs transition-colors shrink-0"
                title="Delete equality"
              >
                x
              </button>
            </div>
          );
        }

        const superior = charMap.get(row.rel.superiorId);
        const inferior = charMap.get(row.rel.inferiorId);
        if (!superior || !inferior) return null;

        const isStrict = row.rel.strict ?? false;

        return (
          <div
            key={row.rel.id}
            className="flex items-center gap-3 p-2 rounded bg-[#1e1e1e] border border-gray-700"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-white font-medium truncate">{superior.name}</span>
                <button
                  onClick={() => updateRelationshipStrict(row.rel.id, !isStrict)}
                  className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-mono border transition-colors cursor-pointer ${
                    isStrict
                      ? 'text-orange-400 bg-orange-900/20 border-orange-700/50 hover:bg-orange-900/40'
                      : 'text-amber-400 bg-amber-900/20 border-amber-700/50 hover:bg-amber-900/40'
                  }`}
                  title={isStrict ? 'Strictly higher tier (click to toggle)' : 'Same tier or higher (click to toggle)'}
                >
                  {isStrict ? '>' : '>='}
                </button>
                <span className="text-white font-medium truncate">{inferior.name}</span>
              </div>
              {row.rel.note && (
                <p className="text-[10px] text-gray-500 italic truncate mt-0.5">{row.rel.note}</p>
              )}
            </div>
            <button
              onClick={() => deleteRelationship(row.rel.id)}
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
