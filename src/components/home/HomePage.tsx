import { useState } from 'react';
import { useUIStore } from '../../stores/ui-store';
import {
  useAllTierLists,
  createTierList,
  deleteTierList,
  updateTierListName,
  duplicateAsSimpleList,
} from '../../hooks/use-tier-list';
import type { TierList, TierListMode, TierDefinition } from '../../types';
import { DEFAULT_TIER_DEFS } from '../../types';

export function HomePage() {
  const tierLists = useAllTierLists();
  const openTierList = useUIStore((s) => s.openTierList);
  const setHelpOpen = useUIStore((s) => s.setHelpOpen);
  const setSnapshotsOpen = useUIStore((s) => s.setSnapshotsOpen);
  const setSyncOpen = useUIStore((s) => s.setSyncOpen);
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<TierListMode>('graph');

  async function handleCreate() {
    const name = newName.trim() || 'Untitled Tier List';
    const id = await createTierList(name, newMode);
    setNewName('');
    openTierList(id);
  }

  async function handleCopyAsSimple(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const newId = await duplicateAsSimpleList(id);
    openTierList(newId);
  }

  function handleOpen(id: string) {
    openTierList(id);
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const name = tierLists.find((tl) => tl.id === id)?.name ?? 'this tier list';
    if (!window.confirm(`Delete "${name}" and all its characters and relationships? Restorable only from a Backup snapshot.`)) return;
    await deleteTierList(id);
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Power Tier List</h1>
            <p className="text-gray-500 text-sm">
              {tierLists.length} tier list{tierLists.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setSnapshotsOpen(true)}
              className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-[#1e1e1e] hover:bg-[#2a2a2a]
                         border border-gray-700 rounded-lg transition-colors"
            >
              Backups
            </button>
            <button
              onClick={() => setSyncOpen(true)}
              className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-[#1e1e1e] hover:bg-[#2a2a2a]
                         border border-gray-700 rounded-lg transition-colors"
            >
              Sync
            </button>
            <button
              onClick={() => setHelpOpen(true)}
              className="w-9 h-9 flex items-center justify-center text-sm text-gray-400 hover:text-white
                         bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-gray-700 rounded-lg transition-colors"
              title="How it works"
            >
              ?
            </button>
          </div>
        </div>

        {/* Create new */}
        <div className="flex gap-3 mb-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="New tier list name..."
            className="flex-1 bg-[#1e1e1e] border border-gray-700 rounded-lg px-4 py-3 text-sm text-white
                       placeholder-gray-600 focus:border-amber-500 focus:outline-none"
          />
          <div className="flex items-center border border-gray-700 rounded-lg overflow-hidden shrink-0">
            {(
              [
                { mode: 'graph', label: 'Graph', title: 'Relationships + constraint enforcement' },
                { mode: 'simple', label: 'Simple', title: 'Plain tier list — just drag things in' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.mode}
                onClick={() => setNewMode(opt.mode)}
                title={opt.title}
                className={`px-4 py-3 text-sm transition-colors ${
                  newMode === opt.mode
                    ? 'bg-gray-600 text-white'
                    : 'bg-[#1e1e1e] text-gray-500 hover:text-gray-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleCreate}
            className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium
                       rounded-lg transition-colors shrink-0"
          >
            Create
          </button>
        </div>
        <p className="text-[11px] text-gray-600 mb-8">
          {newMode === 'graph'
            ? 'Graph: rankings driven by relationships (A > B) with automatic enforcement.'
            : 'Simple: a regular tier list — drag characters wherever you want, no rules.'}
        </p>

        {/* Tier list grid */}
        {tierLists.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-500 text-lg mb-2">No tier lists yet</p>
            <p className="text-gray-600 text-sm">Create one above to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tierLists.map((tl) => (
              <TierListCard
                key={tl.id}
                tierList={tl}
                onOpen={() => handleOpen(tl.id)}
                onDelete={(e) => handleDelete(e, tl.id)}
                onRename={(name) => updateTierListName(tl.id, name)}
                onCopyAsSimple={(e) => handleCopyAsSimple(e, tl.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TierListCard({
  tierList,
  onOpen,
  onDelete,
  onRename,
  onCopyAsSimple,
}: {
  tierList: TierList;
  onOpen: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onRename: (name: string) => void;
  onCopyAsSimple: (e: React.MouseEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(tierList.name);

  const tierDefs: TierDefinition[] = tierList.tierDefs ?? DEFAULT_TIER_DEFS;

  const tierCounts = new Map<string, number>();
  for (const t of tierList.tiers) {
    tierCounts.set(t.tier, (tierCounts.get(t.tier) ?? 0) + 1);
  }
  const totalPlaced = tierList.tiers.length;
  const lastEdited = new Date(tierList.updatedAt).toLocaleDateString();

  function handleSaveName() {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== tierList.name) {
      onRename(trimmed);
    }
    setEditing(false);
  }

  return (
    <div
      onClick={onOpen}
      className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-4 cursor-pointer
                 hover:border-gray-600 transition-colors group"
    >
      {/* Mini tier preview */}
      <div className="rounded overflow-hidden mb-3 border border-gray-800">
        {tierDefs.map((td) => {
          const count = tierCounts.get(td.id) ?? 0;
          return (
            <div key={td.id} className="flex items-center h-4">
              <div
                className="w-6 shrink-0 h-full flex items-center justify-center text-[8px] font-bold"
                style={{ backgroundColor: td.color, color: '#141414' }}
              >
                {td.name}
              </div>
              <div className="flex-1 bg-[#141414] h-full flex items-center px-1">
                {count > 0 && (
                  <div
                    className="h-2 rounded-sm bg-gray-600"
                    style={{ width: `${Math.min(count * 8, 100)}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Name */}
      {editing ? (
        <input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveName();
            if (e.key === 'Escape') setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          autoFocus
          className="w-full bg-[#141414] border border-gray-600 rounded px-2 py-1 text-sm text-white
                     focus:border-amber-400 focus:outline-none"
        />
      ) : (
        <h3 className="text-sm font-medium text-white truncate flex items-center gap-1.5">
          <span className="truncate">{tierList.name}</span>
          {tierList.mode === 'simple' && (
            <span
              className="shrink-0 px-1 py-px text-[9px] uppercase tracking-wider text-gray-500 border border-gray-700 rounded"
              title="Simple list — free placement, no relationships"
            >
              simple
            </span>
          )}
        </h3>
      )}

      {/* Meta */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-gray-500">
          {totalPlaced} placed &middot; {lastEdited}
        </span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {tierList.mode !== 'simple' && (
            <button
              onClick={onCopyAsSimple}
              className="text-[10px] text-gray-500 hover:text-gray-300 px-1"
              title="Copy into a new simple list: same tiers and placements, relationships left behind"
            >
              → simple
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditName(tierList.name);
              setEditing(true);
            }}
            className="text-[10px] text-gray-500 hover:text-gray-300 px-1"
            title="Rename"
          >
            rename
          </button>
          <button
            onClick={onDelete}
            className="text-[10px] text-gray-500 hover:text-red-400 px-1"
            title="Delete"
          >
            delete
          </button>
        </div>
      </div>
    </div>
  );
}
