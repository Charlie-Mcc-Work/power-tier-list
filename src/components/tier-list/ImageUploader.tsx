import { useCallback, useRef, useState } from 'react';
import { addCharacter } from '../../hooks/use-characters';

function nameFromFilename(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
}

export function ImageUploader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith('image/'),
    );
    for (const file of imageFiles) {
      const name = nameFromFilename(file.name);
      await addCharacter(name, file);
    }
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

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`
        mt-4 p-6 rounded-lg border-2 border-dashed cursor-pointer
        transition-colors text-center
        ${
          isDragOver
            ? 'border-blue-400 bg-blue-400/10 text-blue-300'
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
        File names will be used as character names
      </p>
    </div>
  );
}
