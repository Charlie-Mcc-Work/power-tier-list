import { useState, useEffect, useCallback } from 'react';
import { createSnapshot, listSnapshots, restoreSnapshot, deleteSnapshot } from '../../db/export-import';

interface SnapshotInfo {
  id: string;
  name: string;
  createdAt: number;
}

// Global toggle so NavBar and HomePage can open this
let openFn: (() => void) | null = null;
export function openSnapshotManager() {
  openFn?.();
}

export function SnapshotManager() {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  openFn = useCallback(() => setOpen(true), []);

  async function refresh() {
    const list = await listSnapshots();
    setSnapshots(list);
  }

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  async function handleCreate() {
    setLoading(true);
    const now = new Date();
    await createSnapshot(
      `Manual ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    );
    await refresh();
    setMessage('Snapshot created');
    setTimeout(() => setMessage(null), 2000);
    setLoading(false);
  }

  async function handleRestore(id: string) {
    setLoading(true);
    await restoreSnapshot(id);
    await refresh();
    setMessage('Restored! Refresh the page to see changes.');
    setLoading(false);
  }

  async function handleDelete(id: string) {
    await deleteSnapshot(id);
    await refresh();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a1a] border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-sm font-medium text-white">Backups</h2>
          <button
            onClick={() => { setOpen(false); setMessage(null); }}
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            x
          </button>
        </div>

        <div className="p-4 border-b border-gray-700">
          <button
            onClick={handleCreate}
            disabled={loading}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded
                       transition-colors disabled:opacity-50 w-full"
          >
            {loading ? 'Working...' : 'Create Backup Now'}
          </button>
          <p className="text-[10px] text-gray-500 mt-2">
            Backups are created automatically on each app start and before imports.
            Last 20 kept.
          </p>
          {message && (
            <p className="text-xs text-green-400 mt-2">{message}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {snapshots.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No backups yet</p>
          ) : (
            <div className="space-y-2">
              {snapshots.map((snap) => (
                <div
                  key={snap.id}
                  className="flex items-center gap-3 p-3 rounded bg-[#141414] border border-gray-800"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{snap.name}</p>
                    <p className="text-[10px] text-gray-500">
                      {new Date(snap.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRestore(snap.id)}
                    disabled={loading}
                    className="px-3 py-1 text-xs text-amber-400 hover:text-amber-300 border border-amber-700/50
                               rounded transition-colors disabled:opacity-50"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => handleDelete(snap.id)}
                    className="text-gray-600 hover:text-red-400 text-xs transition-colors"
                    title="Delete backup"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
