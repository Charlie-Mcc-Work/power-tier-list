import { useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { useUIStore, CARD_SIZES } from '../../stores/ui-store';
import { useCharacters } from '../../hooks/use-characters';
import { useTierList } from '../../hooks/use-tier-list';
import { useImage } from '../../hooks/use-image';
import type { Character, TierDefinition } from '../../types';
import { DEFAULT_TIER_DEFS } from '../../types';

function PresentationCard({ character }: { character: Character }) {
  const imageUrl = useImage(character.imageId);
  const imageDisplay = useUIStore((s) => s.imageDisplay);
  const cardSize = useUIStore((s) => s.cardSize);
  const sizes = CARD_SIZES[cardSize];

  return (
    <div
      className="flex flex-col items-center gap-0.5 p-0.5 shrink-0"
      style={{ width: sizes.card }}
    >
      <div
        className="rounded overflow-hidden bg-gray-800"
        style={{ width: sizes.img, height: sizes.img }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={character.name}
            className={`w-full h-full ${imageDisplay === 'contain' ? 'object-contain' : 'object-cover'}`}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-gray-500"
            style={{ fontSize: sizes.img * 0.35 }}
          >
            ?
          </div>
        )}
      </div>
      <span
        className="text-gray-300 text-center leading-tight truncate w-full"
        style={{ fontSize: sizes.text }}
      >
        {character.name}
      </span>
    </div>
  );
}

function PresentationTierRow({
  tierDef,
  characters,
}: {
  tierDef: TierDefinition;
  characters: Character[];
}) {
  return (
    <div className="flex items-stretch border-b border-gray-800 last:border-0">
      <div
        className="w-14 shrink-0 flex items-center justify-center font-bold text-lg"
        style={{ backgroundColor: tierDef.color, color: '#141414' }}
      >
        {tierDef.name}
      </div>
      <div className="flex-1 flex items-center gap-1 p-1.5 flex-wrap min-h-[48px] bg-[#141414]">
        {characters.map((char) => (
          <PresentationCard key={char.id} character={char} />
        ))}
      </div>
    </div>
  );
}

export function PresentationView() {
  const setPresenting = useUIStore((s) => s.setPresenting);
  const cardSize = useUIStore((s) => s.cardSize);
  const setCardSize = useUIStore((s) => s.setCardSize);
  const tierListRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  async function handleSaveImage() {
    if (!tierListRef.current || saving) return;
    setSaving(true);
    try {
      const canvas = await html2canvas(tierListRef.current, {
        backgroundColor: '#0d0d0d',
        scale: 2,
        useCORS: true,
      });
      const link = document.createElement('a');
      link.download = `${tierList?.name ?? 'tier-list'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch {
      // ignore
    }
    setSaving(false);
  }
  const characters = useCharacters();
  const tierList = useTierList();

  const tierDefs = tierList?.tierDefs ?? DEFAULT_TIER_DEFS;
  const assignments = tierList?.tiers ?? [];
  const charMap = new Map(characters.map((c) => [c.id, c]));

  // Escape to exit
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPresenting(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [setPresenting]);

  function getCharactersForTier(tierId: string): Character[] {
    return assignments
      .filter((a) => a.tier === tierId)
      .sort((a, b) => a.position - b.position)
      .map((a) => charMap.get(a.characterId))
      .filter((c): c is Character => c !== undefined);
  }

  const sizes = (['xs', 'sm', 'md', 'lg'] as const);

  return (
    <div className="fixed inset-0 z-[100] bg-[#0d0d0d] flex flex-col">
      {/* Minimal toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a1a] border-b border-gray-800 shrink-0">
        <h2 className="text-sm font-medium text-white">
          {tierList?.name ?? 'Tier List'}
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center border border-gray-600 rounded overflow-hidden">
            {sizes.map((s) => (
              <button
                key={s}
                onClick={() => setCardSize(s)}
                className={`px-1.5 py-0.5 text-[10px] transition-colors ${
                  cardSize === s
                    ? 'bg-gray-600 text-white'
                    : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                }`}
              >
                {CARD_SIZES[s].name}
              </button>
            ))}
          </div>
          <button
            onClick={handleSaveImage}
            disabled={saving}
            className="px-3 py-1 text-xs text-white bg-amber-600 hover:bg-amber-500
                       rounded transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Image'}
          </button>
          <button
            onClick={() => setPresenting(false)}
            className="px-3 py-1 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600
                       rounded transition-colors"
          >
            Exit
          </button>
        </div>
      </div>

      {/* Full tier list */}
      <div className="flex-1 overflow-auto p-4">
        <div ref={tierListRef} className="rounded-lg overflow-hidden border border-gray-700 bg-[#141414]">
          {tierDefs.map((td) => (
            <PresentationTierRow
              key={td.id}
              tierDef={td}
              characters={getCharactersForTier(td.id)}
            />
          ))}
        </div>
      </div>

      <div className="text-center py-1 text-[10px] text-gray-600 shrink-0">
        Press Escape to exit &middot; Use size controls to adjust
      </div>
    </div>
  );
}
