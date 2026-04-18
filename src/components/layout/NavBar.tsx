import { useRef } from 'react';
import { useUIStore, CARD_SIZES } from '../../stores/ui-store';
import type { ImageDisplayMode, CardSize } from '../../stores/ui-store';
import { exportData, importData, downloadExport } from '../../db/export-import';
import { openSnapshotManager } from './SnapshotManager';
import { openHelpPanel } from './HelpPanel';
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
    setPresenting, navigateHome,
  } = useUIStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    const json = await exportData();
    downloadExport(json);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await importData(text);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <nav className="flex items-center gap-1 bg-[#1a1a1a] border-b border-gray-700 px-4">
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
          onClick={openSnapshotManager}
          className="px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600
                     rounded transition-colors"
        >
          Backups
        </button>
        <button
          onClick={handleExport}
          className="px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600
                     rounded transition-colors"
        >
          Export
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600
                     rounded transition-colors"
        >
          Import
        </button>
        <button
          onClick={openHelpPanel}
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
    </nav>
  );
}
