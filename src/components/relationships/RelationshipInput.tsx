import { useState, useRef, useMemo, useEffect } from 'react';
import {
  addRelationshipsFromChain,
  addBulkRelationshipsFromStatements,
} from '../../hooks/use-relationships';
import { enforceAndAutoPlace } from '../../hooks/use-tier-list';
import { fuzzyMatchCharacter } from '../../lib/fuzzy-match';
import type { Character } from '../../types';

interface Props {
  characters: Character[];
}

const OP_REGEX = /(>=|<=|>|<|=)/;
const MAX_SUGGESTIONS = 8;

// ──────────────────────────────────────────────────────────────
// Smart autocomplete input (single / chain mode)
// ──────────────────────────────────────────────────────────────

function SmartInput({ characters }: Props) {
  const [input, setInput] = useState('');
  const [note, setNote] = useState('');
  const [suggestions, setSuggestions] = useState<Character[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Extract the trailing name segment (text after the last operator)
  const trailingName = useMemo(() => {
    const parts = input.split(OP_REGEX);
    return (parts[parts.length - 1] ?? '').trim();
  }, [input]);

  // Update suggestions when the trailing name changes
  useEffect(() => {
    if (trailingName.length === 0) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    const matches = fuzzyMatchCharacter(trailingName, characters).slice(0, MAX_SUGGESTIONS);
    setSuggestions(matches);
    setSelectedIdx(0);
    setShowDropdown(matches.length > 0);
  }, [trailingName, characters]);

  // Scroll the selected item into view
  useEffect(() => {
    if (showDropdown && dropdownRef.current) {
      const el = dropdownRef.current.children[selectedIdx] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx, showDropdown]);

  function completeWithCharacter(char: Character) {
    const parts = input.split(OP_REGEX);
    const trailingPart = parts[parts.length - 1];
    const prefixEnd = input.length - trailingPart.length;
    const prefix = input.slice(0, prefixEnd);
    const spacer = prefix.length > 0 && !prefix.endsWith(' ') ? ' ' : '';
    setInput(prefix + spacer + char.name + ' ');
    setShowDropdown(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIdx((prev) => (prev + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIdx((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        break;
      case 'Tab':
        e.preventDefault();
        completeWithCharacter(suggestions[selectedIdx]);
        break;
      case 'Escape':
        e.preventDefault();
        setShowDropdown(false);
        break;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setError(null);
    setSuccess(null);
    setShowDropdown(false);

    const result = await addRelationshipsFromChain(input, characters, note || undefined);

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
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {/* Main input with autocomplete */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (trailingName.length > 0 && suggestions.length > 0) {
              setShowDropdown(true);
            }
          }}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          placeholder="Type a character name... (chains: A > B > C)"
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-[#1e1e1e] border border-gray-600 rounded px-3 py-2 text-sm text-white
                     font-mono placeholder-gray-500 focus:border-amber-400 focus:outline-none"
        />

        {/* Autocomplete dropdown */}
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
                  idx === selectedIdx
                    ? 'bg-amber-600/30 text-white'
                    : 'text-gray-300 hover:bg-gray-800/50'
                }`}
              >
                <span className="font-mono">{char.name}</span>
                {idx === selectedIdx && (
                  <span className="ml-auto text-[10px] text-gray-500">Tab</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Note field */}
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional) — e.g. Chapter 1044, defeated in combat"
        className="w-full bg-[#141414] border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-300
                   placeholder-gray-600 focus:border-gray-500 focus:outline-none"
      />

      {/* Submit + hints */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded
                     transition-colors shrink-0"
        >
          Add
        </button>
        <span className="text-[10px] text-gray-500 leading-tight">
          Tab to complete &middot; chains: A &gt; B &gt; C
        </span>
      </div>

      <div className="text-[10px] text-gray-600 flex gap-3">
        <span><code className="text-gray-400">&gt;</code> higher tier</span>
        <span><code className="text-gray-400">&gt;=</code> same or higher</span>
        <span><code className="text-gray-400">=</code> same tier</span>
        <span><code className="text-gray-400">&lt;=</code> same or lower</span>
        <span><code className="text-gray-400">&lt;</code> lower tier</span>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-green-400">{success}</p>}
    </form>
  );
}

// ──────────────────────────────────────────────────────────────
// Bulk textarea input
// ──────────────────────────────────────────────────────────────

function BulkInput({ characters }: Props) {
  const [bulkInput, setBulkInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    added: number;
    errors: Array<{ line: number; text: string; error: string }>;
  } | null>(null);

  async function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault();
    const lines = bulkInput.split('\n');
    if (lines.filter((l) => l.trim()).length === 0) return;

    setProcessing(true);
    setBulkResult(null);

    const result = await addBulkRelationshipsFromStatements(lines, characters);
    await enforceAndAutoPlace();

    setBulkResult(result);
    setProcessing(false);
    if (result.errors.length === 0 && result.added > 0) {
      setBulkInput('');
    }
  }

  return (
    <form onSubmit={handleBulkSubmit} className="space-y-2">
      <textarea
        value={bulkInput}
        onChange={(e) => {
          setBulkInput(e.target.value);
          setBulkResult(null);
        }}
        placeholder={`Paste relationships, one per line:\nLuffy > Kaido\nZoro >= King\nA > B > C > D\n\nLines starting with # are ignored`}
        rows={8}
        className="w-full bg-[#1e1e1e] border border-gray-600 rounded px-3 py-2 text-sm text-white
                   placeholder-gray-500 focus:border-amber-400 focus:outline-none resize-y font-mono"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={processing}
          className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded
                     transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processing ? 'Processing...' : 'Add All'}
        </button>
        <span className="text-xs text-gray-500">
          {bulkInput.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length}{' '}
          statements
        </span>
      </div>
      {bulkResult && (
        <div className="text-xs space-y-1">
          {bulkResult.added > 0 && (
            <p className="text-green-400">{bulkResult.added} relationships added</p>
          )}
          {bulkResult.errors.length > 0 && (
            <div className="text-red-400 max-h-32 overflow-y-auto">
              <p>{bulkResult.errors.length} errors:</p>
              {bulkResult.errors.map((err, i) => (
                <p key={i} className="text-red-300/80 pl-2">
                  L{err.line}: {err.error} — <span className="text-gray-500">{err.text}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </form>
  );
}

// ──────────────────────────────────────────────────────────────
// Main export
// ──────────────────────────────────────────────────────────────

export function RelationshipInput({ characters }: Props) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-300">Add Relationships</label>
        <div className="flex gap-1 ml-auto">
          <button
            onClick={() => setMode('single')}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              mode === 'single'
                ? 'bg-amber-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            Single
          </button>
          <button
            onClick={() => setMode('bulk')}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              mode === 'bulk'
                ? 'bg-amber-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            Bulk
          </button>
        </div>
      </div>

      {mode === 'single' ? (
        <SmartInput characters={characters} />
      ) : (
        <BulkInput characters={characters} />
      )}
    </div>
  );
}
