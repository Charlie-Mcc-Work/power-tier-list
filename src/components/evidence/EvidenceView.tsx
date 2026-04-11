import { useState, useMemo } from 'react';
import { useCharacters } from '../../hooks/use-characters';
import { useRelationships } from '../../hooks/use-relationships';
import { useEvidence } from '../../hooks/use-evidence';
import { EvidenceForm } from './EvidenceForm';
import { EvidenceItem } from './EvidenceItem';
import type { EvidenceKind } from '../../types';

export function EvidenceView() {
  const characters = useCharacters();
  const relationships = useRelationships();
  const evidence = useEvidence();
  const [showForm, setShowForm] = useState(false);
  const [filterKind, setFilterKind] = useState<EvidenceKind | 'all'>('all');
  const [filterChar, setFilterChar] = useState<string>('all');

  const filtered = useMemo(() => {
    let items = evidence;
    if (filterKind !== 'all') {
      items = items.filter((e) => e.kind === filterKind);
    }
    if (filterChar !== 'all') {
      items = items.filter((e) => e.characterIds.includes(filterChar));
    }
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }, [evidence, filterKind, filterChar]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value as EvidenceKind | 'all')}
            className="bg-[#1a1a3e] border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
          >
            <option value="all">All Types</option>
            <option value="feat">Feats</option>
            <option value="statement">Statements</option>
            <option value="title">Titles</option>
          </select>
          <select
            value={filterChar}
            onChange={(e) => setFilterChar(e.target.value)}
            className="bg-[#1a1a3e] border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
          >
            <option value="all">All Characters</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
        >
          {showForm ? 'Cancel' : '+ Add Evidence'}
        </button>
      </div>

      {showForm && (
        <EvidenceForm
          characters={characters}
          relationships={relationships}
          onAdded={() => setShowForm(false)}
        />
      )}

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">
            {evidence.length === 0
              ? 'No evidence yet. Click "Add Evidence" to start tracking feats, statements, and titles.'
              : 'No evidence matches the current filters.'}
          </p>
        ) : (
          filtered.map((ev) => (
            <EvidenceItem key={ev.id} evidence={ev} characters={characters} />
          ))
        )}
      </div>
    </div>
  );
}
