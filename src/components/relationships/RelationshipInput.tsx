import { useState, useRef, useMemo, useEffect } from 'react';
import { addRelationshipsFromChain } from '../../hooks/use-relationships';
import { enforceAndAutoPlace } from '../../hooks/use-tier-list';
import { fuzzyMatchCharacter } from '../../lib/fuzzy-match';
import { OP_REGEX } from '../../lib/relationship-parser';
import type { Character } from '../../types';

interface Props {
  characters: Character[];
}

const MAX_SUGGESTIONS = 8;

export function RelationshipInput({ characters }: Props) {
  const [input, setInput] = useState('');
  const [note, setNote] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  // `dismissed` inverts to showDropdown. User gestures (Escape/blur/submit/pick) set it true.
  // Typing clears it. This replaces the previous setState-in-effect pattern.
  const [dismissed, setDismissed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Extract the name fragment being typed (after last operator or comma)
  const trailingName = useMemo(() => {
    const parts = input.split(OP_REGEX);
    const lastSegment = parts[parts.length - 1] ?? '';
    // Within the segment, get text after the last comma
    const commaNames = lastSegment.split(',');
    return (commaNames[commaNames.length - 1] ?? '').trim();
  }, [input]);

  const suggestions = useMemo(() => {
    if (trailingName.length === 0) return [];
    return fuzzyMatchCharacter(trailingName, characters).slice(0, MAX_SUGGESTIONS);
  }, [trailingName, characters]);

  const showDropdown = !dismissed && suggestions.length > 0;
  // Clamp selectedIdx at read time so stale indices don't point off the end.
  const activeIdx = Math.min(selectedIdx, Math.max(0, suggestions.length - 1));

  useEffect(() => {
    if (showDropdown && dropdownRef.current) {
      const el = dropdownRef.current.children[activeIdx] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx, showDropdown]);

  function completeWithCharacter(char: Character) {
    const parts = input.split(OP_REGEX);
    const lastSegment = parts[parts.length - 1];
    const commaIdx = lastSegment.lastIndexOf(',');

    let prefixEnd: number;
    let spacer: string;

    if (commaIdx >= 0) {
      // Replace text after the last comma within this segment
      prefixEnd = input.length - lastSegment.length + commaIdx + 1;
      spacer = ' ';
    } else {
      // Replace the entire last segment
      prefixEnd = input.length - lastSegment.length;
      const prefix = input.slice(0, prefixEnd);
      spacer = prefix.length > 0 && !prefix.endsWith(' ') ? ' ' : '';
    }

    setInput(input.slice(0, prefixEnd) + spacer + char.name + ' ');
    setDismissed(true);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIdx((activeIdx + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIdx((activeIdx - 1 + suggestions.length) % suggestions.length);
        break;
      case 'Tab':
        e.preventDefault();
        completeWithCharacter(suggestions[activeIdx]);
        break;
      case 'Escape':
        e.preventDefault();
        setDismissed(true);
        break;
    }
  }

  async function processLine(line: string): Promise<{ added: number; errors: string[] }> {
    return addRelationshipsFromChain(line, characters, note || undefined);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || processing) return;
    setError(null);
    setSuccess(null);
    setDismissed(true);
    setProcessing(true);

    const result = await processLine(input);

    if (result.added > 0) {
      await enforceAndAutoPlace();
      setSuccess(`${result.added} relationship${result.added > 1 ? 's' : ''} added!`);
      setInput('');
      setNote('');
      setTimeout(() => setSuccess(null), 2500);
    }
    if (result.errors.length > 0) {
      setError(result.errors.join('; '));
    }
    setProcessing(false);
  }

  // Handle multi-line paste: process each line as a separate statement
  async function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\n')) return; // single line — let normal behavior handle it

    e.preventDefault();
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (lines.length <= 1) {
      // Just one line after filtering
      setInput(lines[0] ?? '');
      return;
    }

    // Multi-line paste — batch process
    setProcessing(true);
    setError(null);
    setSuccess(null);
    let totalAdded = 0;
    const allErrors: string[] = [];

    for (const line of lines) {
      const result = await processLine(line);
      totalAdded += result.added;
      allErrors.push(...result.errors);
    }

    if (totalAdded > 0) {
      await enforceAndAutoPlace();
      setSuccess(`${totalAdded} relationships from ${lines.length} lines`);
      setTimeout(() => setSuccess(null), 4000);
    }
    if (allErrors.length > 0) {
      const shown = allErrors.slice(0, 5);
      setError(shown.join('; ') + (allErrors.length > 5 ? ` (+${allErrors.length - 5} more)` : ''));
    }
    setProcessing(false);
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-300">Add Relationships</label>

      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
              setDismissed(false);
              setSelectedIdx(0);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => {
              if (trailingName.length > 0) setDismissed(false);
            }}
            onBlur={() => setTimeout(() => setDismissed(true), 150)}
            placeholder='Type a name... (try "Luffy > Zoro, Sanji, Nami")'
            autoComplete="off"
            spellCheck={false}
            disabled={processing}
            className="w-full bg-[#1e1e1e] border border-gray-600 rounded px-3 py-2 text-sm text-white
                       font-mono placeholder-gray-500 focus:border-amber-400 focus:outline-none
                       disabled:opacity-50"
          />

          {showDropdown && suggestions.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute z-50 left-0 right-0 mt-1 bg-[#1a1a1a] border border-gray-600
                         rounded-lg shadow-2xl max-h-56 overflow-y-auto"
            >
              {suggestions.map((char, idx) => (
                <button
                  key={char.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    completeWithCharacter(char);
                  }}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2
                             transition-colors border-b border-gray-800/50 last:border-0 ${
                    idx === activeIdx
                      ? 'bg-amber-600/30 text-white'
                      : 'text-gray-300 hover:bg-gray-800/50'
                  }`}
                >
                  <span className="font-mono">{char.name}</span>
                  {idx === activeIdx && (
                    <span className="ml-auto text-[10px] text-gray-500">Tab</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional) — e.g. Chapter 1044, defeated in combat"
          className="w-full bg-[#141414] border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-300
                     placeholder-gray-600 focus:border-gray-500 focus:outline-none"
        />

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={processing}
            className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded
                       transition-colors shrink-0 disabled:opacity-50"
          >
            {processing ? 'Adding...' : 'Add'}
          </button>
          <span className="text-[10px] text-gray-500 leading-tight">
            Tab to complete &middot; paste multiple lines
          </span>
        </div>

        <div className="text-[10px] text-gray-600 flex gap-3 flex-wrap">
          <span><code className="text-gray-400">A &gt; B</code> higher tier</span>
          <span><code className="text-gray-400">A &gt;= B</code> same or higher</span>
          <span><code className="text-gray-400">A = B</code> same tier</span>
          <span><code className="text-gray-400">A &gt; B, C, D</code> fan-out</span>
          <span><code className="text-gray-400">A &gt; B &gt; C</code> chain</span>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {success && <p className="text-xs text-green-400">{success}</p>}
      </form>
    </div>
  );
}
