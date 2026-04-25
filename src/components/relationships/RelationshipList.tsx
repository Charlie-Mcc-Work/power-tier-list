import { useDeferredValue, useMemo, useState } from 'react';
import type { Relationship, Character } from '../../types';
import { deleteRelationship, updateRelationshipStrict } from '../../hooks/use-relationships';
import { findRedundantRelationships, type RedundancyInfo } from '../../lib/redundancy';
import { findContradictions, type ContradictionGroup } from '../../lib/contradictions';
import { useUIStore } from '../../stores/ui-store';

interface Props {
  relationships: Relationship[];
  characters: Character[];
}

type SortMode = 'newest' | 'oldest' | 'alphabetical';

interface DisplayRow {
  rel: Relationship;
  leftId: string;
  rightId: string;
  redundant?: RedundancyInfo;
}

function toRows(
  relationships: Relationship[],
  redundantMap: Map<string, RedundancyInfo>,
): DisplayRow[] {
  return relationships.map((rel) => ({
    rel,
    leftId: rel.superiorId,
    rightId: rel.inferiorId,
    redundant: redundantMap.get(rel.id),
  }));
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
  const filter = useUIStore((s) => s.relationshipsFilter);
  const setFilter = useUIStore((s) => s.setRelationshipsFilter);

  const deferredRelationships = useDeferredValue(relationships);
  const redundantMap = useMemo(
    () => findRedundantRelationships(deferredRelationships),
    [deferredRelationships],
  );
  const contradictionGroups = useMemo(
    () => findContradictions(deferredRelationships),
    [deferredRelationships],
  );

  const contradictoryIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of contradictionGroups) {
      for (const id of g.relationshipIds) set.add(id);
    }
    return set;
  }, [contradictionGroups]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return relationships;
    return relationships.filter((r) => {
      const sup = charMap.get(r.superiorId)?.name.toLowerCase() ?? '';
      const inf = charMap.get(r.inferiorId)?.name.toLowerCase() ?? '';
      return sup.includes(q) || inf.includes(q);
    });
  }, [relationships, charMap, search]);

  const flatRows = useMemo(() => {
    const rows = toRows(filtered, redundantMap);
    if (filter === 'redundant') {
      return sortRows(rows.filter((r) => r.redundant), sort, charMap);
    }
    // `all` view just lists everything. Contradictions are rendered separately
    // by group, not through this flat list.
    return sortRows(rows, sort, charMap);
  }, [filtered, charMap, sort, redundantMap, filter]);

  const visibleGroups = useMemo(() => {
    if (filter !== 'contradictions') return [];
    const q = search.toLowerCase().trim();
    if (!q) return contradictionGroups;
    return contradictionGroups.filter((g) =>
      g.characterIds.some((id) => (charMap.get(id)?.name ?? '').toLowerCase().includes(q)),
    );
  }, [filter, search, contradictionGroups, charMap]);

  const redundantCount = useMemo(() => {
    let n = 0;
    for (const r of relationships) if (redundantMap.has(r.id)) n++;
    return n;
  }, [relationships, redundantMap]);

  if (relationships.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4">
        No relationships yet. Add one above.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name..."
          className="flex-1 min-w-[140px] bg-[#141414] border border-gray-700 rounded px-2 py-1 text-xs text-white
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
        <FilterToggle
          label="Redundant"
          count={redundantCount}
          active={filter === 'redundant'}
          tone="amber"
          onToggle={() =>
            setFilter(filter === 'redundant' ? 'all' : 'redundant')
          }
          title={
            redundantCount === 0
              ? 'No redundant relationships detected'
              : filter === 'redundant'
                ? 'Show all relationships'
                : `Show only the ${redundantCount} redundant relationship${redundantCount === 1 ? '' : 's'}`
          }
        />
        <FilterToggle
          label="Contradictions"
          count={contradictoryIds.size}
          active={filter === 'contradictions'}
          tone="red"
          onToggle={() =>
            setFilter(filter === 'contradictions' ? 'all' : 'contradictions')
          }
          title={
            contradictoryIds.size === 0
              ? 'No contradictions detected'
              : filter === 'contradictions'
                ? 'Show all relationships'
                : `Show only the ${contradictoryIds.size} relationship${contradictoryIds.size === 1 ? '' : 's'} that take part in a contradiction`
          }
        />
      </div>

      {filter === 'contradictions' ? (
        <ContradictionsView
          groups={visibleGroups}
          relationships={relationships}
          charMap={charMap}
          redundantMap={redundantMap}
          emptyMessage={
            contradictionGroups.length === 0
              ? 'No contradictions detected.'
              : search
                ? `No contradictions match "${search}".`
                : null
          }
        />
      ) : flatRows.length === 0 ? (
        <p className="text-xs text-gray-500 py-4">
          {filter === 'redundant'
            ? search
              ? `No redundant relationships match "${search}".`
              : 'No redundant relationships detected.'
            : `No matches for "${search}".`}
        </p>
      ) : (
        flatRows.map((row) => (
          <RelationshipRow
            key={row.rel.id}
            row={row}
            charMap={charMap}
            showRedundancy={!!row.redundant}
            inContradiction={contradictoryIds.has(row.rel.id)}
          />
        ))
      )}
    </div>
  );
}

function ContradictionsView({
  groups,
  relationships,
  charMap,
  redundantMap,
  emptyMessage,
}: {
  groups: ContradictionGroup[];
  relationships: Relationship[];
  charMap: Map<string, Character>;
  redundantMap: Map<string, RedundancyInfo>;
  emptyMessage: string | null;
}) {
  if (emptyMessage) {
    return <p className="text-xs text-gray-500 py-4">{emptyMessage}</p>;
  }

  const relById = new Map(relationships.map((r) => [r.id, r]));

  return (
    <div className="space-y-4">
      {groups.map((group, i) => {
        const names = group.characterIds
          .map((id) => charMap.get(id)?.name ?? 'Unknown')
          .sort((a, b) => a.localeCompare(b));
        const rels = [...group.relationshipIds]
          .map((id) => relById.get(id))
          .filter((r): r is Relationship => !!r)
          .sort((a, b) => b.createdAt - a.createdAt);
        return (
          <div
            key={group.id}
            className="rounded-lg border border-red-800/70 bg-red-950/20 p-3"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-red-300">
                  Contradiction {i + 1} &middot; {names.length} character{names.length === 1 ? '' : 's'}, {rels.length} relationship{rels.length === 1 ? '' : 's'}
                </p>
                <p className="text-[11px] text-red-300/70 mt-0.5 truncate">
                  {names.join(', ')}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-red-200/80 mb-2">{group.summary}</p>
            <div className="space-y-1.5">
              {rels.map((rel) => (
                <RelationshipRow
                  key={rel.id}
                  row={{
                    rel,
                    leftId: rel.superiorId,
                    rightId: rel.inferiorId,
                    redundant: redundantMap.get(rel.id),
                  }}
                  charMap={charMap}
                  showRedundancy={false}
                  inContradiction={true}
                />
              ))}
            </div>
            <p className="text-[10px] text-red-300/60 mt-2 italic">
              Delete one of the conflicting relationships to resolve.
            </p>
          </div>
        );
      })}
    </div>
  );
}

function RelationshipRow({
  row,
  charMap,
  showRedundancy,
  inContradiction,
}: {
  row: DisplayRow;
  charMap: Map<string, Character>;
  showRedundancy: boolean;
  inContradiction: boolean;
}) {
  const left = charMap.get(row.leftId);
  const right = charMap.get(row.rightId);
  if (!left || !right) return null;
  const isStrict = row.rel.strict ?? false;
  const borderClass = inContradiction
    ? 'border-red-700/70'
    : showRedundancy
      ? 'border-amber-700/60'
      : 'border-gray-700';
  return (
    <div className={`flex items-center gap-3 p-2 rounded bg-[#1e1e1e] border ${borderClass}`}>
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
            title={isStrict ? 'Strictly higher tier (click to toggle to same-tier)' : 'Same tier, superior before inferior (click to toggle to strict gap)'}
          >
            {isStrict ? '>' : '>='}
          </button>
          <span className="text-white font-medium truncate">{right.name}</span>
          {showRedundancy && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border
                             text-amber-300 bg-amber-900/20 border-amber-700/50">
              redundant
            </span>
          )}
        </div>
        {showRedundancy && row.redundant && (
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
}

function FilterToggle({
  label,
  count,
  active,
  tone,
  onToggle,
  title,
}: {
  label: string;
  count: number;
  active: boolean;
  tone: 'amber' | 'red';
  onToggle: () => void;
  title: string;
}) {
  const toneClasses = tone === 'red'
    ? 'bg-red-800 text-white border-red-700 hover:bg-red-700'
    : 'bg-amber-700 text-white border-amber-600 hover:bg-amber-600';
  return (
    <button
      onClick={onToggle}
      disabled={count === 0 && !active}
      className={`shrink-0 px-2 py-1 text-xs rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active ? toneClasses : 'bg-[#141414] text-gray-300 border-gray-700 hover:border-amber-400'
      }`}
      title={title}
    >
      {label} {count > 0 && <span className="opacity-80">({count})</span>}
    </button>
  );
}
