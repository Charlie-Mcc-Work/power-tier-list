import { useState, useEffect } from 'react';
import { getSyncConfig, setSyncConfig, clearSyncConfig, syncPush, syncPull, createShareLink, checkConnection, probeServer, refreshAutoSync } from '../../lib/sync';
import { log } from '../../lib/logger';
import { useUIStore } from '../../stores/ui-store';

export function SyncPanel() {
  const open = useUIStore((s) => s.syncOpen);
  const setSyncOpen = useUIStore((s) => s.setSyncOpen);
  const setOpen = (v: boolean) => setSyncOpen(v);
  // Default URL to the same origin the app is served from — in a single-container
  // self-host deploy the frontend and sync API share an origin, so no typing needed.
  const [url, setUrl] = useState(() => getSyncConfig()?.url ?? window.location.origin);
  const [token, setToken] = useState(() => getSyncConfig()?.token ?? '');
  const [requiresAuth, setRequiresAuth] = useState<boolean | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const activeTierListId = useUIStore((s) => s.activeTierListId);

  // When the panel opens, probe the server for its auth requirement and (if
  // already configured) re-check the live connection.
  useEffect(() => {
    if (!open || !url) return;
    let cancelled = false;
    probeServer(url).then((probe) => {
      if (cancelled) return;
      setRequiresAuth(probe?.requiresAuth ?? null);
    });
    if (getSyncConfig()) {
      checkConnection().then((ok) => { if (!cancelled) setConnected(ok); });
    }
    return () => { cancelled = true; };
  }, [open, url]);

  async function handleSave() {
    setSyncConfig(url, token);
    setLoading(true);
    try {
      const ok = await checkConnection();
      setConnected(ok);
      if (!ok) {
        setStatus('Connection failed — check URL' + (requiresAuth ? ' and token' : ''));
        return;
      }
      // Two-way sync on connect: pull newer remote lists, then push local lists.
      // Converges both sides without losing either side's edits.
      setStatus('Syncing…');
      await syncPull().catch((err) => log.warn('sync', `pull on connect failed: ${err}`));
      await syncPush().catch((err) => log.warn('sync', `push on connect failed: ${err}`));
      setStatus('Connected — auto-sync on. Edits upload automatically; other devices pull when focused.');
      refreshAutoSync();
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    clearSyncConfig();
    setUrl('');
    setToken('');
    setConnected(null);
    setStatus(null);
    refreshAutoSync();
  }

  async function handlePush() {
    setLoading(true);
    setStatus(null);
    try {
      const { pushed } = await syncPush();
      setStatus(`Pushed ${pushed} tier list${pushed !== 1 ? 's' : ''} to server`);
    } catch (err) {
      setStatus(`Push failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setLoading(false);
  }

  async function handlePull() {
    setLoading(true);
    setStatus(null);
    try {
      const { pulled } = await syncPull();
      setStatus(pulled > 0 ? `Pulled ${pulled} tier list${pulled !== 1 ? 's' : ''}` : 'Already up to date');
    } catch (err) {
      setStatus(`Pull failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setLoading(false);
  }

  async function handleShare() {
    if (!activeTierListId) {
      setStatus('Open a tier list first to share it');
      return;
    }
    setLoading(true);
    setShareUrl(null);
    try {
      const link = await createShareLink(activeTierListId);
      setShareUrl(link);
    } catch (err) {
      setStatus(`Share failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setLoading(false);
  }

  if (!open) return null;

  const config = getSyncConfig();

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a1a] border border-gray-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-sm font-medium text-white">Cloud Sync</h2>
          <button
            onClick={() => { setOpen(false); setStatus(null); setShareUrl(null); }}
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            x
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Server config */}
          <div className="space-y-2">
            <label className="text-xs text-gray-400">Server URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.com:3001"
              className="w-full bg-[#141414] border border-gray-700 rounded px-3 py-2 text-sm text-white
                         placeholder-gray-600 focus:border-amber-400 focus:outline-none"
            />
            {requiresAuth === false && (
              <p className="text-[11px] text-gray-500">
                Server is in open mode — no token needed. Intended for private networks like Tailscale.
              </p>
            )}
            {requiresAuth !== false && (
              <>
                <label className="text-xs text-gray-400">
                  Sync Token {requiresAuth === null && <span className="text-gray-600">(if required)</span>}
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Your secret token"
                  className="w-full bg-[#141414] border border-gray-700 rounded px-3 py-2 text-sm text-white
                             placeholder-gray-600 focus:border-amber-400 focus:outline-none"
                />
              </>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={!url || (requiresAuth === true && !token) || loading}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded
                           transition-colors disabled:opacity-50"
              >
                Connect
              </button>
              {config && (
                <button
                  onClick={handleDisconnect}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
                >
                  Disconnect
                </button>
              )}
              {connected !== null && (
                <span className={`flex items-center gap-1 text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              )}
            </div>
          </div>

          {/* Sync actions */}
          {config && connected && (
            <div className="pt-2 border-t border-gray-700 space-y-2">
              <p className="text-[11px] text-gray-500">
                Auto-sync is on. Edits upload within a couple of seconds; other devices pull when you open or refocus the app. The buttons below force it immediately if you don't want to wait.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handlePush}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded
                             transition-colors disabled:opacity-50"
                >
                  Push Now
                </button>
                <button
                  onClick={handlePull}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded
                             transition-colors disabled:opacity-50"
                >
                  Pull Now
                </button>
              </div>
              <button
                onClick={handleShare}
                disabled={loading}
                className="w-full px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white text-sm rounded
                           transition-colors disabled:opacity-50"
              >
                Share Current List
              </button>
            </div>
          )}

          {/* Share URL */}
          {shareUrl && (
            <div className="p-3 bg-[#141414] rounded border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Share link:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-xs text-white"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(shareUrl)}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 rounded transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          {status && (
            <p className={`text-xs ${status.includes('failed') || status.includes('Failed') ? 'text-red-400' : 'text-green-400'}`}>
              {status}
            </p>
          )}

          <p className="text-[10px] text-gray-600">
            Push uploads all local tier lists to the server. Pull downloads newer versions.
            Share creates a read-only link for the current tier list.
          </p>
        </div>
      </div>
    </div>
  );
}
