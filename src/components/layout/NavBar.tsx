import { useRef } from 'react';
import { useUIStore } from '../../stores/ui-store';
import { exportData, importData, downloadExport } from '../../db/export-import';
import type { AppView } from '../../types';

const tabs: { view: AppView; label: string }[] = [
  { view: 'tierlist', label: 'Tier List' },
  { view: 'relationships', label: 'Relationships' },
  { view: 'evidence', label: 'Evidence' },
];

export function NavBar() {
  const { activeView, setActiveView } = useUIStore();
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
      <h1 className="text-lg font-bold text-white mr-6 py-3">Power Tier List</h1>
      {tabs.map((tab) => (
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
