import { useRef } from 'react';
import { useUIStore } from '../../stores/ui-store';
import { exportData, importData, downloadExport } from '../../db/export-import';
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

export function NavBar() {
  const { activeView, setActiveView, layoutMode, setLayoutMode } = useUIStore();
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
    <nav className="flex items-center gap-1 bg-[#16213e] border-b border-gray-700 px-4">
      <h1 className="text-lg font-bold text-white mr-4 py-3">Power Tier List</h1>

      {/* Layout switcher */}
      <div className="flex items-center border border-gray-600 rounded overflow-hidden mr-4">
        {layouts.map((l) => (
          <button
            key={l.mode}
            onClick={() => setLayoutMode(l.mode)}
            title={l.title}
            className={`px-2.5 py-1.5 text-xs font-mono transition-colors ${
              layoutMode === l.mode
                ? 'bg-blue-600 text-white'
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
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400" />
            )}
          </button>
        ))}

      <div className="ml-auto flex items-center gap-2">
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
