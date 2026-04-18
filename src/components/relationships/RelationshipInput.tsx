import { useState } from 'react';
import { addRelationshipFromStatement, addBulkRelationshipsFromStatements } from '../../hooks/use-relationships';
import { enforceAndAutoPlace } from '../../hooks/use-tier-list';
import type { Character } from '../../types';

interface Props {
  characters: Character[];
}

export function RelationshipInput({ characters }: Props) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [input, setInput] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{
    added: number;
    errors: Array<{ line: number; text: string; error: string }>;
  } | null>(null);
  const [processing, setProcessing] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!input.trim()) return;

    const result = await addRelationshipFromStatement(input, characters);
    if ('error' in result) {
      setError(result.error);
    } else {
      setSuccess('Relationship added!');
      setInput('');
      await enforceAndAutoPlace();
      setTimeout(() => setSuccess(null), 2000);
    }
  }

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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-300">Add Relationships</label>
        <div className="flex gap-1 ml-auto">
          <button
            onClick={() => setMode('single')}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              mode === 'single'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            Single
          </button>
          <button
            onClick={() => setMode('bulk')}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              mode === 'bulk'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            Bulk
          </button>
        </div>
      </div>

      {mode === 'single' ? (
        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              placeholder='e.g. "Mihawk > Shanks" or "Luffy >> Kaido"'
              className="flex-1 bg-[#1a1a3e] border border-gray-600 rounded px-3 py-2 text-sm text-white
                         placeholder-gray-500 focus:border-blue-400 focus:outline-none"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
            >
              Add
            </button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          {success && <p className="text-xs text-green-400">{success}</p>}
        </form>
      ) : (
        <form onSubmit={handleBulkSubmit} className="space-y-2">
          <textarea
            value={bulkInput}
            onChange={(e) => {
              setBulkInput(e.target.value);
              setBulkResult(null);
            }}
            placeholder={`Paste relationships, one per line:\nLuffy >> Kaido\nZoro > King\nSanji > Queen\n\nUse >> (certain), > (likely), >? (speculative)\nLines starting with # are ignored`}
            rows={8}
            className="w-full bg-[#1a1a3e] border border-gray-600 rounded px-3 py-2 text-sm text-white
                       placeholder-gray-500 focus:border-blue-400 focus:outline-none resize-y font-mono"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={processing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? 'Processing...' : 'Add All'}
            </button>
            <span className="text-xs text-gray-500">
              {bulkInput.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length} statements
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
                      Line {err.line}: {err.error} — <span className="text-gray-500">{err.text}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </form>
      )}

      <div className="text-xs text-gray-500">
        Use <code className="text-gray-400">&gt;</code> (likely),{' '}
        <code className="text-gray-400">&gt;&gt;</code> (certain), or{' '}
        <code className="text-gray-400">&gt;?</code> (speculative)
      </div>
    </div>
  );
}
