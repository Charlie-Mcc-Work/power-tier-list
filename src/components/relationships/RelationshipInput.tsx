import { useState } from 'react';
import { addRelationshipFromStatement } from '../../hooks/use-relationships';
import type { Character } from '../../types';

interface Props {
  characters: Character[];
}

export function RelationshipInput({ characters }: Props) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      setTimeout(() => setSuccess(null), 2000);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <label className="block text-sm font-medium text-gray-300">
        Add Relationship
      </label>
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
      <div className="text-xs text-gray-500">
        Use <code className="text-gray-400">&gt;</code> (likely),{' '}
        <code className="text-gray-400">&gt;&gt;</code> (certain), or{' '}
        <code className="text-gray-400">&gt;?</code> (speculative)
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-green-400">{success}</p>}
    </form>
  );
}
