import { useState } from 'react';
import { useCharacter, updateCharacterName, deleteCharacter } from '../../hooks/use-characters';
import { useRelationships } from '../../hooks/use-relationships';
import { useEvidenceForCharacter } from '../../hooks/use-evidence';
import { useCharacters } from '../../hooks/use-characters';
import { useImage } from '../../hooks/use-image';
import { EvidenceItem } from '../evidence/EvidenceItem';

interface Props {
  characterId: string;
  onClose: () => void;
}

export function CharacterDetail({ characterId, onClose }: Props) {
  const character = useCharacter(characterId);
  const characters = useCharacters();
  const relationships = useRelationships();
  const evidence = useEvidenceForCharacter(characterId);
  const imageUrl = useImage(character?.imageId);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState('');

  if (!character) return null;

  const charMap = new Map(characters.map((c) => [c.id, c]));
  const charRelationships = relationships.filter(
    (r) => r.superiorId === characterId || r.inferiorId === characterId,
  );

  function startEditName() {
    setEditName(character!.name);
    setIsEditingName(true);
  }

  async function saveName() {
    if (editName.trim()) {
      await updateCharacterName(characterId, editName.trim());
    }
    setIsEditingName(false);
  }

  async function handleDelete() {
    await deleteCharacter(characterId);
    onClose();
  }

  return (
    <>
      {/* Mobile backdrop — tap to dismiss */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50 md:hidden"
        aria-hidden="true"
      />
      <div
        className="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-[#1a1a1a] border-l border-gray-700 overflow-y-auto flex flex-col
                   md:static md:z-auto md:w-80 md:max-w-none"
      >
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h2 className="text-sm font-medium text-white">Character Details</h2>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-white transition-colors text-lg"
          aria-label="Close"
        >
          x
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Image */}
        <div className="flex justify-center">
          <div className="w-32 h-32 rounded-lg overflow-hidden bg-gray-800">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={character.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-500 text-4xl">
                ?
              </div>
            )}
          </div>
        </div>

        {/* Name */}
        <div className="text-center">
          {isEditingName ? (
            <div className="flex gap-2 justify-center">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveName()}
                autoFocus
                className="bg-[#141414] border border-gray-600 rounded px-2 py-1 text-base sm:text-sm text-white text-center focus:border-amber-400 focus:outline-none"
              />
              <button
                onClick={saveName}
                className="text-xs text-green-400 hover:text-green-300"
              >
                Save
              </button>
            </div>
          ) : (
            <h3
              className="text-lg font-medium text-white cursor-pointer hover:text-amber-300 transition-colors"
              onClick={startEditName}
              title="Click to edit name"
            >
              {character.name}
            </h3>
          )}
        </div>

        {/* Relationships */}
        <div>
          <h4 className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
            Relationships ({charRelationships.length})
          </h4>
          {charRelationships.length === 0 ? (
            <p className="text-xs text-gray-500">No relationships</p>
          ) : (
            <div className="space-y-1">
              {charRelationships.map((rel) => {
                const isSuper = rel.superiorId === characterId;
                const otherId = isSuper ? rel.inferiorId : rel.superiorId;
                const otherName = charMap.get(otherId)?.name ?? '?';
                return (
                  <div
                    key={rel.id}
                    className="text-xs p-1.5 rounded bg-[#141414] text-gray-300"
                  >
                    {isSuper ? (
                      <>
                        <span className="text-green-400 font-mono">{rel.strict ? '>' : '>='}</span> {otherName}
                      </>
                    ) : (
                      <>
                        <span className="text-red-400 font-mono">{rel.strict ? '<' : '<='}</span> {otherName}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Evidence */}
        <div>
          <h4 className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
            Evidence ({evidence.length})
          </h4>
          {evidence.length === 0 ? (
            <p className="text-xs text-gray-500">No evidence</p>
          ) : (
            <div className="space-y-2">
              {evidence.map((ev) => (
                <EvidenceItem key={ev.id} evidence={ev} characters={characters} />
              ))}
            </div>
          )}
        </div>

        {/* Delete */}
        <button
          onClick={handleDelete}
          className="w-full py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20
                     rounded border border-red-800/30 transition-colors"
        >
          Delete Character
        </button>
      </div>
      </div>
    </>
  );
}
