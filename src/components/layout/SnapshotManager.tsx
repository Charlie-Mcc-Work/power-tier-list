import { useState, useEffect, useCallback } from 'react';
import { createSnapshot, listSnapshots, restoreSnapshot, deleteSnapshot, clearAllSnapshots } from '../../db/export-import';
import {
  pickBackupFolder,
  reauthorizeBackupFolder,
  clearBackupFolder,
  writeBackupNow,
  getBackupStatus,
  type BackupStatus,
  downloadBackupNow,
  downloadFullBackupNow,
  getLastDownloadStatus,
  type LastDownloadStatus,
} from '../../db/auto-backup';
import { useUIStore } from '../../stores/ui-store';

interface SnapshotInfo {
  id: string;
  name: string;
  createdAt: number;
}

function formatAgo(at: number | null): string {
  if (!at) return 'never';
  const diff = Date.now() - at;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function SnapshotManager() {
  const open = useUIStore((s) => s.snapshotsOpen);
  const setSnapshotsOpen = useUIStore((s) => s.setSnapshotsOpen);
  const setOpen = (v: boolean) => setSnapshotsOpen(v);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<LastDownloadStatus | null>(null);

  const refreshStatus = useCallback(async () => {
    const [bs, ds] = await Promise.all([getBackupStatus(), getLastDownloadStatus()]);
    setBackupStatus(bs);
    setDownloadStatus(ds);
  }, []);

  async function refresh() {
    const [list] = await Promise.all([listSnapshots(), refreshStatus()]);
    setSnapshots(list);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([listSnapshots(), getBackupStatus(), getLastDownloadStatus()]).then(
      ([list, bs, ds]) => {
        if (cancelled) return;
        setSnapshots(list);
        setBackupStatus(bs);
        setDownloadStatus(ds);
      },
    );
    return () => { cancelled = true; };
  }, [open]);

  async function handleCreate() {
    setLoading(true);
    const now = new Date();
    await createSnapshot(
      `Manual ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      { core: true },
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

  async function handleClearAll() {
    if (!window.confirm(
      'Delete ALL in-browser snapshots? Your current tier lists, characters, relationships, and images are NOT affected — only the backup history is wiped. Use this if the app is using too much memory.',
    )) return;
    setLoading(true);
    const res = await clearAllSnapshots();
    await refresh();
    setLoading(false);
    setMessage(`Cleared ${res.deleted} snapshot${res.deleted === 1 ? '' : 's'}. Current data untouched.`);
  }

  async function handlePickFolder() {
    setLoading(true);
    const res = await pickBackupFolder();
    await refreshStatus();
    setLoading(false);
    setMessage(res.ok ? `Folder set: "${res.name}" — click "Back up now" to write.` : `Not enabled: ${res.reason}`);
  }

  async function handleReauthorize() {
    setLoading(true);
    const ok = await reauthorizeBackupFolder();
    await refreshStatus();
    setLoading(false);
    setMessage(ok ? 'Folder re-authorized' : 'Re-authorization denied');
  }

  async function handleClearFolder() {
    setLoading(true);
    await clearBackupFolder();
    await refreshStatus();
    setLoading(false);
    setMessage('Backup folder cleared');
  }

  async function handleBackupNow() {
    setLoading(true);
    const res = await writeBackupNow();
    await refreshStatus();
    setLoading(false);
    setMessage(res.ok ? `Wrote ${res.filename}` : `Backup failed: ${res.reason}`);
  }

  async function handleDownloadNow() {
    setLoading(true);
    const res = await downloadBackupNow();
    await refreshStatus();
    setLoading(false);
    setMessage(res.ok ? `Downloaded ${res.filename}` : `Download failed: ${res.reason}`);
  }

  async function handleDownloadFull() {
    setLoading(true);
    setMessage('Encoding images... this may take a moment.');
    const res = await downloadFullBackupNow();
    setLoading(false);
    setMessage(res.ok ? `Downloaded ${res.filename}` : `Full backup failed: ${res.reason}`);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a1a] border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-sm font-medium text-white">Backups</h2>
          <button
            onClick={() => { setOpen(false); setMessage(null); }}
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            x
          </button>
        </div>

        <div className="p-3 bg-[#141414] border-b border-gray-800 text-[11px] text-gray-400">
          <strong className="text-gray-300">Manual backups only.</strong> Nothing runs in the
          background — every action here happens when you click a button. Back up regularly
          using the buttons below, and keep the files somewhere outside the browser
          (a cloud-synced folder, a USB drive, etc.).
        </div>

        {/* Picked folder (Chromium-only convenience — still manual) */}
        {backupStatus?.supported && (
          <div className="p-4 border-b border-gray-700 space-y-2">
            <h3 className="text-xs font-medium text-gray-300 uppercase tracking-wider">
              Picked folder (Chromium)
            </h3>
            {backupStatus.folderName == null ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">
                  Pick a folder once and the &ldquo;Back up now&rdquo; button will write a
                  timestamped JSON there without a save dialog every time. Last 30 files kept.
                </p>
                <button
                  onClick={handlePickFolder}
                  disabled={loading}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded
                             transition-colors disabled:opacity-50 w-full"
                >
                  Choose folder...
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-gray-300">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      backupStatus.permission === 'granted' ? 'bg-green-400' : 'bg-amber-400'
                    }`} />
                    <span className="font-mono">{backupStatus.folderName}</span>
                  </div>
                  <p className="text-[10px] text-gray-500 ml-3.5 mt-0.5">
                    Last folder backup: {formatAgo(backupStatus.lastBackupAt)}
                  </p>
                </div>
                {backupStatus.permission === 'granted' ? (
                  <div className="flex gap-2">
                    <button
                      onClick={handleBackupNow}
                      disabled={loading}
                      className="flex-1 px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded
                                 transition-colors disabled:opacity-50"
                    >
                      Back up now
                    </button>
                    <button
                      onClick={handleClearFolder}
                      disabled={loading}
                      className="px-3 py-1 text-xs text-gray-400 hover:text-red-400 transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={handleReauthorize}
                      disabled={loading}
                      className="flex-1 px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded
                                 transition-colors disabled:opacity-50"
                    >
                      Re-authorize
                    </button>
                    <button
                      onClick={handleClearFolder}
                      disabled={loading}
                      className="px-3 py-1 text-xs text-gray-400 hover:text-red-400 transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Manual download buttons */}
        <div className="p-4 border-b border-gray-700 space-y-2">
          <h3 className="text-xs font-medium text-gray-300 uppercase tracking-wider">
            Download backup
          </h3>
          <div className="flex gap-2">
            <button
              onClick={handleDownloadNow}
              disabled={loading}
              className="flex-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded
                         transition-colors disabled:opacity-50"
              title="Fast: saves everything except image blobs. Images remain in your browser and are preserved across restores."
            >
              Download (fast, no images)
            </button>
            <button
              onClick={handleDownloadFull}
              disabled={loading}
              className="flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded
                         transition-colors disabled:opacity-50"
              title="Complete: includes every image blob base64-encoded. Slower; may freeze the UI for a few seconds on large collections."
            >
              Download full (with images)
            </button>
          </div>
          <p className="text-[10px] text-gray-500">
            Last download: {formatAgo(downloadStatus?.lastDownloadAt ?? null)}.
            Fast download excludes images (KB, instant). Full includes images (MB, seconds).
          </p>
        </div>

        {/* In-browser snapshots */}
        <div className="p-4 border-b border-gray-700 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-gray-300 uppercase tracking-wider">
              In-browser snapshots
            </h3>
            {snapshots.length > 0 && (
              <button
                onClick={handleClearAll}
                disabled={loading}
                className="text-[10px] text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
                title="Clear all snapshots to free memory. Does NOT affect your live data."
                type="button"
              >
                Clear all
              </button>
            )}
          </div>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded
                       transition-colors disabled:opacity-50 w-full"
          >
            {loading ? 'Working...' : 'Create Snapshot Now'}
          </button>
          <p className="text-[10px] text-gray-500">
            Snapshots live inside the browser and are useful for quick undo. Created only
            when you click above, or automatically once right before an Import. Up to 20 kept.
            Don&rsquo;t rely on them for disaster recovery — use Download regularly.
          </p>
          {message && (
            <p className="text-xs text-green-400">{message}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {snapshots.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No snapshots yet</p>
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
                    title="Delete snapshot"
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
