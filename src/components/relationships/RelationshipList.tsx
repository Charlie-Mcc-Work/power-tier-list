import { useMemo, useState } from 'react';
import type { Relationship, Character } from '../../types';
import { deleteRelationship, updateRelationshipStrict } from '../../hooks/use-relationships';
import { db } from '../../db/database';
import { findRedundantRelationships, type RedundancyInfo } from '../../lib/redundancy';

interface Props {
  relationships: Relationship[];
  characters: Character[];
}

type SortMode = 'newest' | 'oldest' | 'alphabetical';

interface DisplayRow {
  type: 'directional' | 'equality';
  rel: Relationship;
  reverseRel?: Relationship; // for equality pairs
  /** Character shown on the left side of the row (superior, or alphabetically-earlier for equality) */
  leftId: string;
  rightId: string;
  /**
   * Populated for redundant rows. For equality rows this is present only when
   * BOTH mirror edges are independently redundant, since deleting the row
   * removes both edges.
   */
  redundant?: RedundancyInfo;
}

function buildDisplayRows(
  relationships: Relationship[],
  charMap: Map<string, Character>,
  redundantMap: Map<string, RedundancyInfo>,
): DisplayRow[] {
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
      // Bidirectional non-strict = equality. Render with the alphabetically-earlier
      // name on the left so the display order matches alphabetical sort.
      consumed.add(rel.id);
      consumed.add(reverse.id);
      const aName = charMap.get(rel.superiorId)?.name ?? '';
      const bName = charMap.get(rel.inferiorId)?.name ?? '';
      const aFirst = aName.toLowerCase() <= bName.toLowerCase();
      // Only call the equality row redundant when BOTH directions have a
      // separate implying path — otherwise deleting the row loses info.
      const bothRedundant =
        redundantMap.has(rel.id) && redundantMap.has(reverse.id);
      rows.push({
        type: 'equality',
        rel,
        reverseRel: reverse,
        leftId: aFirst ? rel.superiorId : rel.inferiorId,
        rightId: aFirst ? rel.inferiorId : rel.superiorId,
        redundant: bothRedundant ? redundantMap.get(rel.id) : undefined,
      });
    } else {
      consumed.add(rel.id);
      rows.push({
        type: 'directional',
        rel,
        leftId: rel.superiorId,
        rightId: rel.inferiorId,
        redundant: redundantMap.get(rel.id),
      });
    }
  }

  return rows;
}

function formatImpliedBy(info: RedundancyInfo, charMap: Map<string, Character>): string {
  if (info.path.length < 2) return '';
  const names = info.path.map((id) => charMap.get(id)?.name ?? id);
  let s = names[0];
  for (let i = 1; i < names.length; i++) {
    const op = info.edgeStrict[i - 1] ? '>' : '>=';
    s += ` ${op} ${names[i]}`;
  }
  return s;
}

function sortRows(rows: DisplayRow[], mode: SortMode, charMap: Map<string, Character>): DisplayRow[] {
  const copy = [...rows];
  if (mode === 'newest') {
    copy.sort((a, b) => b.rel.createdAt - a.rel.createdAt);
  } else if (mode === 'oldest') {
    copy.sort((a, b) => a.rel.createdAt - b.rel.createdAt);
  } else {
    // alphabetical: by leading name, then by right-side name, case-insensitive
    copy.sort((a, b) => {
      const aLeft = (charMap.get(a.leftId)?.name ?? '').toLowerCase();
      const bLeft = (charMap.get(b.leftId)?.name ?? '').toLowerCase();
      if (aLeft !== bLeft) return aLeft.localeCompare(bLeft);
      const aRight = (charMap.get(a.rightId)?.name ?? '').toLowerCase();
      const bRight = (charMap.get(b.rightId)?.name ?? '').toLowerCase();
      return aRight.localeCompare(bRight);
    });
  }
  return copy;
}

export function RelationshipList({ relationships, characters }: Props) {
  const charMap = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters],
  );
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');
  const [redundantOnly, setRedundantOnly] = useState(false);

  // Redundancy is computed over the full graph — you need the complete graph to
  // know what's implied. Search/filter only affects which rows are shown.
  const redundantMap = useMemo(
    () => findRedundantRelationships(relationships),
    [relationships],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return relationships;
    return relationships.filter((r) => {
      const sup = charMap.get(r.superiorId)?.name.toLowerCase() ?? '';
      const inf = charMap.get(r.inferiorId)?.name.toLowerCase() ?? '';
      return sup.includes(q) || inf.includes(q);
    });
  }, [relationships, charMap, search]);

  const sortedRows = useMemo(() => {
    const rows = buildDisplayRows(filtered, charMap, redundantMap);
    const visible = redundantOnly ? rows.filter((r) => r.redundant) : rows;
    return sortRows(visible, sort, charMap);
  }, [filtered, charMap, sort, redundantMap, redundantOnly]);

  const redundantCount = useMemo(() => {
    // Count visible rows — equality pairs consume two ids but display as one row.
    return buildDisplayRows(relationships, charMap, redundantMap)
      .filter((r) => r.redundant).length;
  }, [relationships, charMap, redundantMap]);

  if (relationships.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4">
        No relationships yet. Add one above.
      </p>
    );
  }

  async function handleDeleteEquality(rel: Relationship, reverseRel: Relationship) {
    await db.transaction('rw', db.relationships, async () => {
      await deleteRelationship(rel.id);
      await deleteRelationship(reverseRel.id);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name..."
          className="flex-1 min-w-0 bg-[#141414] border border-gray-700 rounded px-2 py-1 text-xs text-white
                     placeholder-gray-600 focus:border-amber-400 focus:outline-none"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          className="bg-[#141414] border border-gray-700 rounded px-2 py-1 text-xs text-gray-300
                     focus:border-amber-400 focus:outline-none"
          title="Sort order"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="alphabetical">A–Z</option>
        </select>
        <button
          onClick={() => setRedundantOnly((v) => !v)}
          disabled={redundantCount === 0 && !redundantOnly}
          className={`shrink-0 px-2 py-1 text-xs rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            redundantOnly
              ? 'bg-amber-700 text-white border-amber-600 hover:bg-amber-600'
              : 'bg-[#141414] text-gray-300 border-gray-700 hover:border-amber-400'
          }`}
          title={
            redundantCount === 0
              ? 'No redundant relationships detected'
              : redundantOnly
                ? 'Show all relationships'
                : `Show only the ${redundantCount} redundant relationship${redundantCount === 1 ? '' : 's'}`
          }
        >
          Redundant {redundantCount > 0 && <span className="opacity-80">({redundantCount})</span>}
        </button>
      </div>

      {sortedRows.length === 0 ? (
        <p className="text-xs text-gray-500 py-4">
          {redundantOnly
            ? search
              ? `No redundant relationships match "${search}".`
              : 'No redundant relationships detected.'
            : `No matches for "${search}".`}
        </p>
      ) : (
        sortedRows.map((row) => {
          const left = charMap.get(row.leftId);
          const right = charMap.get(row.rightId);
          if (!left || !right) return null;

          if (row.type === 'equality') {
            return (
              <div
                key={row.rel.id}
                className={`flex items-center gap-3 p-2 rounded bg-[#1e1e1e] border ${
                  row.redundant ? 'border-amber-700/60' : 'border-gray-700'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="text-white font-medium truncate">{left.name}</span>
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-xs font-mono border
                                     text-green-400 bg-green-900/20 border-green-700/50">
                      =
                    </span>
                    <span className="text-white font-medium truncate">{right.name}</span>
                    {row.redundant && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border
                                       text-amber-300 bg-amber-900/20 border-amber-700/50">
                        redundant
                      </span>
                    )}
                  </div>
                  {row.redundant && (
                    <p className="text-[10px] text-amber-400/70 truncate mt-0.5">
                      implied by: {formatImpliedBy(row.redundant, charMap)}
                    </p>
                  )}
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

          const isStrict = row.rel.strict ?? false;

          return (
            <div
              key={row.rel.id}
              className={`flex items-center gap-3 p-2 rounded bg-[#1e1e1e] border ${
                row.redundant ? 'border-amber-700/60' : 'border-gray-700'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <span className="text-white font-medium truncate">{left.name}</span>
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
                  <span className="text-white font-medium truncate">{right.name}</span>
                  {row.redundant && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border
                                     text-amber-300 bg-amber-900/20 border-amber-700/50">
                      redundant
                    </span>
                  )}
                </div>
                {row.redundant && (
                  <p className="text-[10px] text-amber-400/70 truncate mt-0.5">
                    implied by: {formatImpliedBy(row.redundant, charMap)}
                  </p>
                )}
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
        })
      )}
    </div>
  );
}
