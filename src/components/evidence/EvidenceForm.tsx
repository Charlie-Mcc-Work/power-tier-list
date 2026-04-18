import { useState } from 'react';
import { addEvidence } from '../../hooks/use-evidence';
import type { Character, Relationship, EvidenceKind } from '../../types';

interface Props {
  characters: Character[];
  relationships: Relationship[];
  defaultCharacterIds?: string[];
  defaultRelationshipIds?: string[];
  onAdded?: () => void;
}

export function EvidenceForm({
  characters,
  relationships,
  defaultCharacterIds = [],
  defaultRelationshipIds = [],
  onAdded,
}: Props) {
  const [kind, setKind] = useState<EvidenceKind>('feat');
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>(defaultCharacterIds);
  const [selectedRelIds, setSelectedRelIds] = useState<string[]>(defaultRelationshipIds);

  const charMap = new Map(characters.map((c) => [c.id, c]));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || selectedCharIds.length === 0) return;

    await addEvidence(kind, text.trim(), selectedCharIds, selectedRelIds, source.trim() || undefined);
    setText('');
    setSource('');
    setSelectedCharIds(defaultCharacterIds);
    setSelectedRelIds(defaultRelationshipIds);
    onAdded?.();
  }

  function toggleCharacter(id: string) {
    setSelectedCharIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  function toggleRelationship(id: string) {
    setSelectedRelIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id],
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 bg-[#1e1e1e] rounded-lg border border-gray-700">
      <div className="flex gap-2">
        {(['feat', 'statement', 'title'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`px-3 py-1 text-xs rounded capitalize transition-colors ${
              kind === k
                ? 'bg-amber-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          kind === 'feat'
            ? 'e.g. "Defeated Kaido in 1v1"'
            : kind === 'title'
              ? 'e.g. "World\'s Strongest Swordsman"'
              : 'e.g. "Oda stated Mihawk is stronger"'
        }
        className="w-full bg-[#141414] border border-gray-600 rounded px-3 py-2 text-sm text-white
                   placeholder-gray-500 focus:border-amber-400 focus:outline-none"
      />

      <input
        type="text"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder="Source (e.g. Chapter 1058, SBS Vol 4)"
        className="w-full bg-[#141414] border border-gray-600 rounded px-3 py-2 text-sm text-white
                   placeholder-gray-500 focus:border-amber-400 focus:outline-none"
      />

      <div>
        <label className="block text-xs text-gray-400 mb-1">Characters</label>
        <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
          {characters.map((char) => (
            <button
              key={char.id}
              type="button"
              onClick={() => toggleCharacter(char.id)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                selectedCharIds.includes(char.id)
                  ? 'bg-amber-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {char.name}
            </button>
          ))}
        </div>
      </div>

      {relationships.length > 0 && (
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Supports Relationships
          </label>
          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
            {relationships.map((rel) => {
              const sup = charMap.get(rel.superiorId)?.name ?? '?';
              const inf = charMap.get(rel.inferiorId)?.name ?? '?';
              return (
                <button
                  key={rel.id}
                  type="button"
                  onClick={() => toggleRelationship(rel.id)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    selectedRelIds.includes(rel.id)
                      ? 'bg-amber-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {sup} &gt; {inf}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={!text.trim() || selectedCharIds.length === 0}
        className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500
                   text-white text-sm rounded transition-colors"
      >
        Add Evidence
      </button>
    </form>
  );
}
