import { useEffect, useRef, useState } from 'react';
import { subscribeSyncStatus, type SyncStatus } from '../../lib/sync';
import { useUIStore, CARD_SIZES } from '../../stores/ui-store';
import type { ImageDisplayMode, CardSize } from '../../stores/ui-store';
import {
  exportSingleList,
  importSingleListReplace,
  importSingleListAsNew,
  detectImportFileKind,
  downloadExport,
} from '../../db/export-import';
import type { AppView, LayoutMode } from '../../types';

const tabs: { view: AppView; label: string }[] = [
  { view: 'tierlist', label: 'Tier List' },
  { view: 'relationships', label: 'Relationships' },
  { view: 'evidence', label: 'Evidence' },
];

const layouts: { mode: LayoutMode; label: string; title: string }[] = [
  { mode: 'triple', label: '|||', title: 'All panels' },
  { mode: 'split', label: '|+', title: 'Tier list + side pane' },
  { mode: 'tabs', label: '[ ]', title: 'Single view' },
];

const imageDisplayOptions: { mode: ImageDisplayMode; label: string; title: string }[] = [
  { mode: 'contain', label: 'Fit', title: 'Show full image (no crop)' },
  { mode: 'cover', label: 'Fill', title: 'Fill square (may crop)' },
];

const cardSizeOptions: CardSize[] = ['xs', 'sm', 'md', 'lg'];

export function NavBar() {
  const {
    activeView, setActiveView, layoutMode, setLayoutMode,
    imageDisplay, setImageDisplay, cardSize, setCardSize,
    setPresenting, navigateHome, showTierCounts, setShowTierCounts,
    searchQuery, setSearchQuery,
    setHelpOpen, setSnapshotsOpen, setSyncOpen,
    activeTierListId, openTierList,
  } = useUIStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('disabled');

  // Close the mobile menu when the viewport grows past sm.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    function handle(e: MediaQueryListEvent | MediaQueryList) {
      if (e.matches) setMobileMenuOpen(false);
    }
    mq.addEventListener('change', handle);
    return () => mq.removeEventListener('change', handle);
  }, []);

  useEffect(() => subscribeSyncStatus(setSyncStatus), []);

  // Auto-clear status after a short while.
  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(null), status.kind === 'err' ? 8000 : 4000);
    return () => clearTimeout(id);
  }, [status]);

  async function handleExport() {
    if (busy) return;
    if (!activeTierListId) {
      setStatus({ kind: 'err', text: 'Open a tier list first — Export saves the list you are viewing.' });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const json = await exportSingleList(activeTierListId);
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      // Prefer the tier-list name in the filename; fall back to date if empty.
      const rawName = JSON.parse(json).tierList?.name ?? '';
      const safeName = String(rawName).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'list';
      const filename = `tierlist-${safeName}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
      downloadExport(json, filename);
      const kb = Math.round(json.length / 1024);
      setStatus({ kind: 'ok', text: `Exported "${rawName}" (${kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'})` });
    } catch (err) {
      setStatus({ kind: 'err', text: `Export failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = ''; // allow re-picking same file
    if (busy) return;

    setBusy(true);
    setStatus(null);
    try {
      const text = await file.text();
      const detected = detectImportFileKind(text);

      if (detected.kind === 'unknown') {
        setStatus({ kind: 'err', text: detected.error });
        return;
      }

      if (detected.kind === 'full-db') {
        setStatus({
          kind: 'err',
          text: 'This file is a full-database backup, not a single-list export. Use Backups → Restore from file for full-DB restores.',
        });
        return;
      }

      // Single-list file. Offer Replace current / Add new / Cancel.
      const listName = detected.data.tierList.name || 'Untitled';
      const charCount = detected.data.characters.length;
      const currentListBlurb = activeTierListId
        ? `\n\nReplace: the list you're currently viewing will be overwritten with "${listName}" (its contents wiped, then filled from the file). Your other tier lists are untouched.`
        : '\n\n(No active list, so Replace is unavailable — Add as new list only.)';

      const wantsReplace = activeTierListId
        ? window.confirm(
            `Import list "${listName}" (${charCount} character${charCount === 1 ? '' : 's'}) from "${file.name}"?${currentListBlurb}\n\nClick OK to REPLACE the current list with this one, or Cancel to see the Add-as-new option.`,
          )
        : false;

      if (wantsReplace && activeTierListId) {
        const summary = await importSingleListReplace(activeTierListId, detected.data);
        setStatus({
          kind: 'ok',
          text: `Replaced current list with "${listName}": ${summary.characters} character${summary.characters === 1 ? '' : 's'}, ${summary.relationships} relationship${summary.relationships === 1 ? '' : 's'}, ${summary.images} image${summary.images === 1 ? '' : 's'}`,
        });
        return;
      }

      const wantsAdd = window.confirm(
        `Add "${listName}" as a new tier list alongside your existing ones? A backup snapshot is taken first so this is reversible.\n\nClick OK to add, or Cancel to abort.`,
      );
      if (!wantsAdd) return;

      const summary = await importSingleListAsNew(detected.data);
      // Hop to the new list so the user sees it immediately.
      openTierList(summary.newTierListId);
      setStatus({
        kind: 'ok',
        text: `Added "${listName}": ${summary.characters} character${summary.characters === 1 ? '' : 's'}, ${summary.relationships} relationship${summary.relationships === 1 ? '' : 's'}, ${summary.images} image${summary.images === 1 ? '' : 's'}`,
      });
    } catch (err) {
      setStatus({ kind: 'err', text: `Import failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <nav className="flex items-center gap-1 bg-[#1a1a1a] border-b border-gray-700 px-2 sm:px-3 py-1 flex-wrap sm:flex-nowrap sm:py-0">
      <button
        onClick={navigateHome}
        className="text-gray-400 hover:text-white transition-colors mr-1 sm:mr-2 w-9 h-9 sm:w-auto sm:h-auto sm:py-3 flex items-center justify-center text-base sm:text-sm"
        title="Back to all tier lists"
        aria-label="Back"
      >
        &larr;
      </button>
      <h1
        onClick={navigateHome}
        className="text-base sm:text-lg font-bold text-white mr-2 sm:mr-4 sm:py-3 cursor-pointer hover:text-amber-400 transition-colors truncate"
      >
        Power Tier List
      </h1>

      {/* Layout switcher — hidden on mobile (auto-switches to tabs below 768px) */}
      <div className="hidden md:flex items-center border border-gray-600 rounded overflow-hidden mr-3">
        {layouts.map((l) => (
          <button
            key={l.mode}
            onClick={() => setLayoutMode(l.mode)}
            title={l.title}
            className={`px-2.5 py-1.5 text-xs font-mono transition-colors ${
              layoutMode === l.mode
                ? 'bg-amber-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* Tab nav — only shown in tabs mode */}
      {layoutMode === 'tabs' &&
        tabs.map((tab) => (
          <button
            key={tab.view}
            onClick={() => setActiveView(tab.view)}
            className={`px-3 sm:px-4 py-3 text-sm font-medium transition-colors relative ${
              activeView === tab.view
                ? 'text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
            {activeView === tab.view && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400" />
            )}
          </button>
        ))}

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-28 sm:w-32 bg-[#141414] border border-gray-700 rounded px-2 py-2 sm:py-1 text-base sm:text-xs text-white
                       placeholder-gray-600 focus:border-amber-400 focus:outline-none sm:focus:w-48
                       transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
              aria-label="Clear search"
            >
              x
            </button>
          )}
        </div>

        {/* Desktop-only display toggles */}
        <button
          onClick={() => setShowTierCounts(!showTierCounts)}
          title={showTierCounts ? 'Hide tier counts' : 'Show tier counts'}
          className={`hidden sm:inline-flex px-2 py-1 text-[10px] rounded border transition-colors ${
            showTierCounts
              ? 'bg-gray-600 text-white border-gray-500'
              : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300'
          }`}
        >
          #
        </button>

        <div className="hidden sm:flex items-center border border-gray-600 rounded overflow-hidden">
          {cardSizeOptions.map((s) => (
            <button
              key={s}
              onClick={() => setCardSize(s)}
              title={`Card size: ${CARD_SIZES[s].name}`}
              className={`px-1.5 py-1 text-[10px] transition-colors ${
                cardSize === s
                  ? 'bg-gray-600 text-white'
                  : 'bg-gray-800 text-gray-500 hover:text-gray-300'
              }`}
            >
              {CARD_SIZES[s].name}
            </button>
          ))}
        </div>

        <div className="hidden sm:flex items-center border border-gray-600 rounded overflow-hidden">
          {imageDisplayOptions.map((opt) => (
            <button
              key={opt.mode}
              onClick={() => setImageDisplay(opt.mode)}
              title={opt.title}
              className={`px-2 py-1 text-[10px] transition-colors ${
                imageDisplay === opt.mode
                  ? 'bg-gray-600 text-white'
                  : 'bg-gray-800 text-gray-500 hover:text-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Desktop: primary actions visible. Mobile: collapsed into a menu. */}
        <button
          onClick={() => setSyncOpen(true)}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600
                     rounded transition-colors"
          title={syncStatusTitle(syncStatus)}
        >
          <SyncDot status={syncStatus} />
          Sync
        </button>

        <button
          onClick={() => setPresenting(true)}
          className="hidden sm:inline-flex px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-amber-700 hover:bg-amber-600
                     rounded transition-colors"
          title="Full-screen presentation view"
        >
          Present
        </button>

        <button
          onClick={() => setSnapshotsOpen(true)}
          className="hidden sm:inline-flex px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600
                     rounded transition-colors"
        >
          Backups
        </button>
        <button
          onClick={handleExport}
          disabled={busy}
          className="hidden sm:inline-flex px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600
                     rounded transition-colors disabled:opacity-50"
        >
          {busy ? '…' : 'Export'}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="hidden sm:inline-flex px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600
                     rounded transition-colors disabled:opacity-50"
        >
          {busy ? '…' : 'Import'}
        </button>
        <button
          onClick={() => setHelpOpen(true)}
          className="hidden sm:flex w-7 h-7 items-center justify-center text-xs text-gray-400 hover:text-white
                     bg-gray-700 hover:bg-gray-600 rounded-full transition-colors"
          title="How it works"
        >
          ?
        </button>

        {/* Mobile overflow menu */}
        <button
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="sm:hidden w-10 h-10 flex items-center justify-center text-xl text-gray-300 hover:text-white bg-gray-700 rounded transition-colors"
          aria-label="More actions"
          aria-expanded={mobileMenuOpen}
        >
          &#8942;
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          className="hidden"
        />
      </div>

      {/* Mobile menu drawer */}
      {mobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-[150] bg-black/50 sm:hidden"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="sm:hidden fixed top-12 right-2 left-2 z-[160] bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MenuAction label="Present" onClick={() => { setPresenting(true); setMobileMenuOpen(false); }} accent />
              <MenuAction label={syncStatusLabel(syncStatus)} onClick={() => { setSyncOpen(true); setMobileMenuOpen(false); }} />
              <MenuAction label="Backups" onClick={() => { setSnapshotsOpen(true); setMobileMenuOpen(false); }} />
              <MenuAction label="Help" onClick={() => { setHelpOpen(true); setMobileMenuOpen(false); }} />
              <MenuAction label={busy ? '…' : 'Export'} disabled={busy} onClick={() => { handleExport(); setMobileMenuOpen(false); }} />
              <MenuAction label={busy ? '…' : 'Import'} disabled={busy} onClick={() => { fileInputRef.current?.click(); setMobileMenuOpen(false); }} />
            </div>

            <div className="pt-2 border-t border-gray-700 space-y-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Card Size</div>
                <div className="flex gap-1">
                  {cardSizeOptions.map((s) => (
                    <button
                      key={s}
                      onClick={() => setCardSize(s)}
                      className={`flex-1 py-2 rounded text-xs transition-colors ${
                        cardSize === s
                          ? 'bg-amber-600 text-white'
                          : 'bg-gray-800 text-gray-400'
                      }`}
                    >
                      {CARD_SIZES[s].name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Image Display</div>
                <div className="flex gap-1">
                  {imageDisplayOptions.map((opt) => (
                    <button
                      key={opt.mode}
                      onClick={() => setImageDisplay(opt.mode)}
                      className={`flex-1 py-2 rounded text-xs transition-colors ${
                        imageDisplay === opt.mode
                          ? 'bg-amber-600 text-white'
                          : 'bg-gray-800 text-gray-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setShowTierCounts(!showTierCounts)}
                className={`w-full py-2 rounded text-xs transition-colors ${
                  showTierCounts ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400'
                }`}
              >
                {showTierCounts ? 'Hide Tier Counts' : 'Show Tier Counts'}
              </button>
            </div>
          </div>
        </>
      )}

      {status && (
        <div
          className={`fixed top-3 left-1/2 -translate-x-1/2 z-[400] px-4 py-2 rounded-lg shadow-xl border text-xs max-w-xl
                      ${status.kind === 'ok'
                        ? 'bg-green-900/90 border-green-700 text-green-100'
                        : 'bg-red-900/90 border-red-700 text-red-100'}`}
          role="status"
        >
          <div className="flex items-center gap-3">
            <span className="flex-1">{status.text}</span>
            <button
              onClick={() => setStatus(null)}
              className="opacity-60 hover:opacity-100"
              aria-label="Dismiss"
            >
              x
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}

function MenuAction({
  label,
  onClick,
  disabled,
  accent,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`py-3 rounded text-sm font-medium transition-colors disabled:opacity-50 ${
        accent
          ? 'bg-amber-700 hover:bg-amber-600 text-white'
          : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

function SyncDot({ status }: { status: SyncStatus }) {
  const cls =
    status === 'synced' ? 'bg-green-400'
    : status === 'syncing' ? 'bg-amber-400 animate-pulse'
    : status === 'offline' ? 'bg-red-400'
    : 'bg-gray-500';
  return <span className={`w-2 h-2 rounded-full ${cls}`} aria-hidden="true" />;
}

function syncStatusTitle(status: SyncStatus): string {
  switch (status) {
    case 'synced': return 'All edits synced to the server';
    case 'syncing': return 'Uploading recent edits…';
    case 'offline': return 'Sync server unreachable — local edits will upload when reconnected';
    case 'disabled': return 'Sync not configured — click to set up';
    default: return 'Sync';
  }
}

function syncStatusLabel(status: SyncStatus): string {
  switch (status) {
    case 'synced': return 'Sync · up to date';
    case 'syncing': return 'Sync · uploading…';
    case 'offline': return 'Sync · offline';
    default: return 'Sync';
  }
}
