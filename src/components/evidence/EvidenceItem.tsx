import type { Evidence, Character } from '../../types';
import { deleteEvidence } from '../../hooks/use-evidence';

interface Props {
  evidence: Evidence;
  characters: Character[];
}

const KIND_LABELS: Record<string, { label: string; color: string }> = {
  feat: { label: 'Feat', color: 'text-orange-400 bg-orange-900/30 border-orange-700/50' },
  statement: { label: 'Statement', color: 'text-blue-400 bg-blue-900/30 border-blue-700/50' },
  title: { label: 'Title', color: 'text-purple-400 bg-purple-900/30 border-purple-700/50' },
};

export function EvidenceItem({ evidence, characters }: Props) {
  const charMap = new Map(characters.map((c) => [c.id, c]));
  const kindInfo = KIND_LABELS[evidence.kind] ?? KIND_LABELS.feat;

  return (
    <div className="p-3 bg-[#1a1a3e] rounded-lg border border-gray-700 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1">
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border ${kindInfo.color}`}
          >
            {kindInfo.label}
          </span>
          <span className="text-sm text-white">{evidence.text}</span>
        </div>
        <button
          onClick={() => deleteEvidence(evidence.id)}
          className="text-gray-500 hover:text-red-400 text-xs transition-colors shrink-0"
          title="Delete evidence"
        >
          x
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-400">
        {evidence.source && <span>Source: {evidence.source}</span>}
        {evidence.characterIds.length > 0 && (
          <span>
            Characters:{' '}
            {evidence.characterIds
              .map((id) => charMap.get(id)?.name ?? '?')
              .join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}
