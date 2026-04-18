import { useCallback, useRef, useState } from 'react';
import { addCharacter, addBulkCharactersByName, setCharacterImage } from '../../hooks/use-characters';
import { db } from '../../db/database';
import { getActiveTierListId } from '../../hooks/use-tier-list';

function nameFromFilename(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
}

export function ImageUploader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [mode, setMode] = useState<'images' | 'names'>('images');
  const [nameInput, setNameInput] = useState('');
  const [bulkResult, setBulkResult] = useState<{ added: number; skipped: number } | null>(null);
  const [uploadResult, setUploadResult] = useState<{ created: number; matched: number } | null>(null);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    const tierListId = getActiveTierListId();
    const characters = await db.characters.where('tierListId').equals(tierListId).toArray();
    let created = 0;
    let matched = 0;

    for (const file of imageFiles) {
      const name = nameFromFilename(file.name);
      // Try to match to existing character (case-insensitive)
      const existing = characters.find(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      );

      if (existing) {
        await setCharacterImage(existing.id, file);
        matched++;
      } else {
        await addCharacter(name, file);
        created++;
      }
    }

    setUploadResult({ created, matched });
    setTimeout(() => setUploadResult(null), 4000);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  async function handleBulkNames() {
    const names = nameInput.split('\n').filter((n) => n.trim());
    if (names.length === 0) return;
    const result = await addBulkCharactersByName(names);
    setBulkResult(result);
    if (result.added > 0) setNameInput('');
    setTimeout(() => setBulkResult(null), 4000);
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex gap-1">
        <button
          onClick={() => setMode('images')}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            mode === 'images'
              ? 'bg-amber-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
        >
          Upload Images
        </button>
        <button
          onClick={() => setMode('names')}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            mode === 'names'
              ? 'bg-amber-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
        >
          Add by Name
        </button>
      </div>

      {mode === 'images' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`
            p-6 rounded-lg border-2 border-dashed cursor-pointer
            transition-colors text-center
            ${
              isDragOver
                ? 'border-amber-400 bg-amber-400/10 text-amber-300'
                : 'border-gray-600 hover:border-gray-500 text-gray-400 hover:text-gray-300'
            }
          `}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
            className="hidden"
          />
          <p className="text-sm">Drop character images here or click to upload</p>
          <p className="text-xs mt-1 text-gray-500">
            Matches existing characters by filename, or creates new ones
          </p>
          {uploadResult && (
            <p className="text-xs mt-2 text-green-400">
              {uploadResult.created > 0 && `${uploadResult.created} created`}
              {uploadResult.created > 0 && uploadResult.matched > 0 && ', '}
              {uploadResult.matched > 0 && `${uploadResult.matched} images matched`}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Paste character names, one per line..."
            rows={8}
            className="w-full bg-[#1e1e1e] border border-gray-600 rounded px-3 py-2 text-sm text-white
                       placeholder-gray-500 focus:border-amber-400 focus:outline-none resize-y font-mono"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handleBulkNames}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded transition-colors"
            >
              Add Characters
            </button>
            <span className="text-xs text-gray-500">
              {nameInput.split('\n').filter((n) => n.trim()).length} names
            </span>
            {bulkResult && (
              <span className="text-xs text-green-400">
                {bulkResult.added} added
                {bulkResult.skipped > 0 && `, ${bulkResult.skipped} already exist`}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
