import { useState } from 'react';
import type { TierDefinition } from '../../types';
import { addTierDef, removeTierDef, renameTierDef, recolorTierDef, reorderTierDefs } from '../../hooks/use-tier-list';

interface Props {
  tierDefs: TierDefinition[];
}

export function TierManager({ tierDefs }: Props) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#7fafff');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    await addTierDef(name, newColor);
    setNewName('');
  }

  async function handleRemove(tierId: string) {
    if (tierDefs.length <= 1) return;
    await removeTierDef(tierId);
  }

  async function handleMoveUp(idx: number) {
    if (idx <= 0) return;
    const ids = tierDefs.map((t) => t.id);
    [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
    await reorderTierDefs(ids);
  }

  async function handleMoveDown(idx: number) {
    if (idx >= tierDefs.length - 1) return;
    const ids = tierDefs.map((t) => t.id);
    [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
    await reorderTierDefs(ids);
  }

  function startEditing(td: TierDefinition) {
    setEditingId(td.id);
    setEditName(td.name);
  }

  async function saveEdit(tierId: string) {
    const trimmed = editName.trim();
    if (trimmed) {
      await renameTierDef(tierId, trimmed);
    }
    setEditingId(null);
  }

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        {open ? 'Hide' : 'Manage'} Tiers
      </button>

      {open && (
        <div className="mt-2 p-3 rounded-lg border border-gray-700 bg-[#1a1a1a] space-y-2">
          {/* Current tiers */}
          {tierDefs.map((td, idx) => (
            <div key={td.id} className="flex items-center gap-2 h-8">
              {/* Reorder buttons */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => handleMoveUp(idx)}
                  disabled={idx === 0}
                  className="text-[10px] text-gray-500 hover:text-gray-300 disabled:opacity-30 leading-none"
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  onClick={() => handleMoveDown(idx)}
                  disabled={idx === tierDefs.length - 1}
                  className="text-[10px] text-gray-500 hover:text-gray-300 disabled:opacity-30 leading-none"
                  title="Move down"
                >
                  ▼
                </button>
              </div>

              {/* Color swatch / picker */}
              <input
                type="color"
                value={td.color}
                onChange={(e) => recolorTierDef(td.id, e.target.value)}
                className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent"
                title="Change color"
              />

              {/* Name (editable) */}
              {editingId === td.id ? (
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => saveEdit(td.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(td.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  autoFocus
                  className="flex-1 bg-[#141414] border border-gray-600 rounded px-2 py-0.5 text-xs text-white
                             focus:border-amber-400 focus:outline-none"
                />
              ) : (
                <span
                  onClick={() => startEditing(td)}
                  className="flex-1 text-xs text-gray-300 cursor-pointer hover:text-white"
                  title="Click to rename"
                >
                  {td.name}
                </span>
              )}

              {/* Delete */}
              <button
                onClick={() => handleRemove(td.id)}
                disabled={tierDefs.length <= 1}
                className="text-[10px] text-gray-500 hover:text-red-400 disabled:opacity-30 px-1"
                title="Remove tier"
              >
                ✕
              </button>
            </div>
          ))}

          {/* Add new tier */}
          <div className="flex items-center gap-2 pt-2 border-t border-gray-700">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent"
            />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="New tier name..."
              className="flex-1 bg-[#141414] border border-gray-700 rounded px-2 py-1 text-xs text-white
                         placeholder-gray-600 focus:border-amber-400 focus:outline-none"
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim()}
              className="text-xs px-2 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
