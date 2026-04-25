import { useEffect, useMemo, useState } from 'react';
import { useUIStore } from '../../stores/ui-store';
import { useCharacters } from '../../hooks/use-characters';
import { useTierList } from '../../hooks/use-tier-list';
import { DEFAULT_TIER_DEFS } from '../../types';

export function CopyAsTextModal() {
  const open = useUIStore((s) => s.copyTextOpen);
  const setOpen = useUIStore((s) => s.setCopyTextOpen);
  const tierList = useTierList();
  const characters = useCharacters();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const text = useMemo(() => {
    if (!tierList) return '';
    const tierDefs = tierList.tierDefs ?? DEFAULT_TIER_DEFS;
    const charName = new Map(characters.map((c) => [c.id, c.name]));
    const lines: string[] = [];
    for (const td of tierDefs) {
      const entries = tierList.tiers
        .filter((a) => a.tier === td.id)
        .sort((a, b) => a.position - b.position)
        .map((a) => charName.get(a.characterId))
        .filter((n): n is string => !!n);
      lines.push(`${td.name}: ${entries.join(', ')}`);
    }
    return lines.join('\n');
  }, [tierList, characters]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, setOpen]);

  if (!open) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyError(null);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : String(err));
      setTimeout(() => setCopyError(null), 4000);
    }
  }

  const lineCount = text ? text.split('\n').length : 0;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-[#1a1a1a] border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h2 className="text-sm font-medium text-white">Copy as Text</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {tierList?.name ?? 'Tier List'} &middot; {lineCount} tier{lineCount === 1 ? '' : 's'}
            </p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-400 hover:text-white transition-colors text-sm"
            aria-label="Close"
          >
            x
          </button>
        </div>

        <div className="flex-1 overflow-hidden p-4 flex flex-col gap-3 min-h-0">
          <textarea
            readOnly
            value={text}
            className="flex-1 w-full min-h-[220px] bg-[#141414] border border-gray-700 rounded px-3 py-2
                       font-mono text-xs text-gray-200 resize-none focus:border-amber-400 focus:outline-none"
            onClick={(e) => e.currentTarget.select()}
          />

          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] text-gray-500">
              {copyError ? (
                <span className="text-red-400">Couldn't copy: {copyError}</span>
              ) : copied ? (
                <span className="text-green-400">Copied to clipboard.</span>
              ) : (
                <span>Click the textarea to select all, or use the button.</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600
                           rounded transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleCopy}
                disabled={!text}
                className="px-3 py-1.5 text-xs text-white bg-amber-700 hover:bg-amber-600
                           disabled:opacity-50 rounded transition-colors"
              >
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
