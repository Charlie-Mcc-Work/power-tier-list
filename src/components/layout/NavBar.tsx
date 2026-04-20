import { useEffect, useRef, useState } from 'react';
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
    <nav className="flex items-center gap-1 bg-[#1a1a1a] border-b border-gray-700 px-3 py-1 flex-wrap sm:flex-nowrap sm:py-0">
      <button
        onClick={navigateHome}
        className="text-gray-400 hover:text-white transition-colors mr-2 py-3 text-sm"
        title="Back to all tier lists"
      >
        &larr;
      </button>
      <h1
        onClick={navigateHome}
        className="text-lg font-bold text-white mr-4 py-3 cursor-pointer hover:text-amber-400 transition-colors"
      >
        Power Tier List
      </h1>

      {/* Layout switcher */}
      <div className="flex items-center border border-gray-600 rounded overflow-hidden mr-3">
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
            className={`px-4 py-3 text-sm font-medium transition-colors relative ${
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

      <div className="ml-auto flex items-center gap-2">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-32 bg-[#141414] border border-gray-700 rounded px-2 py-1 text-xs text-white
                       placeholder-gray-600 focus:border-amber-400 focus:outline-none focus:w-48
                       transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
            >
              x
            </button>
          )}
        </div>

        {/* Tier count toggle */}
        <button
          onClick={() => setShowTierCounts(!showTierCounts)}
          title={showTierCounts ? 'Hide tier counts' : 'Show tier counts'}
          className={`px-2 py-1 text-[10px] rounded border transition-colors ${
            showTierCounts
              ? 'bg-gray-600 text-white border-gray-500'
              : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300'
          }`}
        >
          #
        </button>

        {/* Card size */}
        <div className="flex items-center border border-gray-600 rounded overflow-hidden">
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

        {/* Image display toggle */}
        <div className="flex items-center border border-gray-600 rounded overflow-hidden">
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

        {/* Sync */}
        <button
          onClick={() => setSyncOpen(true)}
          className="px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600
                     rounded transition-colors"
        >
          Sync
        </button>

        {/* Present button */}
        <button
          onClick={() => setPresenting(true)}
          className="px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-amber-700 hover:bg-amber-600
                     rounded transition-colors"
          title="Full-screen presentation view"
        >
          Present
        </button>

        <button
          onClick={() => setSnapshotsOpen(true)}
          className="px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600
                     rounded transition-colors"
        >
          Backups
        </button>
        <button
          onClick={handleExport}
          disabled={busy}
          className="px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600
                     rounded transition-colors disabled:opacity-50"
        >
          {busy ? '…' : 'Export'}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600
                     rounded transition-colors disabled:opacity-50"
        >
          {busy ? '…' : 'Import'}
        </button>
        <button
          onClick={() => setHelpOpen(true)}
          className="w-7 h-7 flex items-center justify-center text-xs text-gray-400 hover:text-white
                     bg-gray-700 hover:bg-gray-600 rounded-full transition-colors"
          title="How it works"
        >
          ?
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          className="hidden"
        />
      </div>

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
