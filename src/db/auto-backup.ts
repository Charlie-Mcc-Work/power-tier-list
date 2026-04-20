import { db } from './database';
import { exportData, exportCoreData, downloadExport } from './export-import';

// Light timing helper — logs any step that crosses 100ms on the main thread.
function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  return fn().finally(() => {
    const elapsed = performance.now() - start;
    if (elapsed > 100) {
      console.info(`[auto-backup] ${label} took ${Math.round(elapsed)}ms`);
    }
  });
}

// ── Persistent storage ────────────────────────────────────────────────
// One-shot permission request. Does not schedule any timers or write any
// data — only asks the browser not to evict our IndexedDB under disk
// pressure.

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    const already = await navigator.storage.persisted();
    if (already) return true;
    return await navigator.storage.persist();
  } catch (err) {
    console.warn('[auto-backup] persist() failed:', err);
    return false;
  }
}

// ── File System Access API backup folder (manual only) ────────────────
// All operations here run exclusively in response to a user clicking a
// button in the Backups panel. There are NO Dexie hooks, NO debounced
// timers, and no background work.

const META_KEY_HANDLE = 'backupFolder';
const META_KEY_LAST_BACKUP = 'lastBackupAt';
const META_KEY_LAST_DOWNLOAD = 'lastDownloadAt';
const MAX_BACKUP_FILES = 30;

export type PermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported' | 'none';

export interface BackupStatus {
  supported: boolean;
  folderName: string | null;
  lastBackupAt: number | null;
  permission: PermissionState;
}

export interface LastDownloadStatus {
  lastDownloadAt: number | null;
}

export function isFileSystemBackupSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

async function getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  const entry = await db.meta.get(META_KEY_HANDLE);
  const value = entry?.value;
  return value && typeof value === 'object' && 'kind' in value
    ? (value as FileSystemDirectoryHandle)
    : null;
}

async function getLastBackupAt(): Promise<number | null> {
  const entry = await db.meta.get(META_KEY_LAST_BACKUP);
  return typeof entry?.value === 'number' ? entry.value : null;
}

async function setLastBackupAt(at: number): Promise<void> {
  await db.meta.put({ key: META_KEY_LAST_BACKUP, value: at });
}

async function queryHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  try {
    const h = handle as FileSystemDirectoryHandle & {
      queryPermission: (opts: { mode: 'readwrite' | 'read' }) => Promise<PermissionState>;
    };
    return await h.queryPermission({ mode: 'readwrite' });
  } catch (err) {
    console.warn('[auto-backup] queryPermission failed:', err);
    return 'denied';
  }
}

async function requestHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  try {
    const h = handle as FileSystemDirectoryHandle & {
      requestPermission: (opts: { mode: 'readwrite' | 'read' }) => Promise<PermissionState>;
    };
    return await h.requestPermission({ mode: 'readwrite' });
  } catch (err) {
    console.warn('[auto-backup] requestPermission failed:', err);
    return 'denied';
  }
}

export async function getBackupStatus(): Promise<BackupStatus> {
  if (!isFileSystemBackupSupported()) {
    return { supported: false, folderName: null, lastBackupAt: null, permission: 'unsupported' };
  }
  const handle = await getStoredHandle();
  if (!handle) {
    return { supported: true, folderName: null, lastBackupAt: null, permission: 'none' };
  }
  const permission = await queryHandlePermission(handle);
  const lastBackupAt = await getLastBackupAt();
  return { supported: true, folderName: handle.name, lastBackupAt, permission };
}

export async function getLastDownloadStatus(): Promise<LastDownloadStatus> {
  const entry = await db.meta.get(META_KEY_LAST_DOWNLOAD);
  return { lastDownloadAt: typeof entry?.value === 'number' ? entry.value : null };
}

/** Prompt for a folder and store the handle. Must be called from a user gesture. */
export async function pickBackupFolder(): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  if (!isFileSystemBackupSupported()) {
    return { ok: false, reason: 'File System Access API not supported in this browser' };
  }
  try {
    const picker = (window as unknown as {
      showDirectoryPicker: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;
    const handle = await picker({ mode: 'readwrite' });
    const state = await queryHandlePermission(handle);
    if (state !== 'granted') {
      const requested = await requestHandlePermission(handle);
      if (requested !== 'granted') {
        return { ok: false, reason: 'Folder chosen but write permission was not granted' };
      }
    }
    await db.meta.put({ key: META_KEY_HANDLE, value: handle });
    return { ok: true, name: handle.name };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, reason: 'Folder selection cancelled' };
    }
    console.warn('[auto-backup] pickBackupFolder failed:', err);
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function reauthorizeBackupFolder(): Promise<boolean> {
  const handle = await getStoredHandle();
  if (!handle) return false;
  const state = await requestHandlePermission(handle);
  return state === 'granted';
}

export async function clearBackupFolder(): Promise<void> {
  await db.meta.delete(META_KEY_HANDLE);
}

function timestampForFilename(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function pruneOldBackups(handle: FileSystemDirectoryHandle): Promise<void> {
  const names: string[] = [];
  const iter = handle as FileSystemDirectoryHandle & {
    entries: () => AsyncIterable<[string, FileSystemHandle]>;
  };
  for await (const [name, entry] of iter.entries()) {
    if (entry.kind === 'file' && name.startsWith('tierlist-backup-') && name.endsWith('.json')) {
      names.push(name);
    }
  }
  if (names.length <= MAX_BACKUP_FILES) return;
  names.sort();
  const excess = names.length - MAX_BACKUP_FILES;
  for (let i = 0; i < excess; i++) {
    try {
      await handle.removeEntry(names[i]);
    } catch (err) {
      console.warn('[auto-backup] failed to prune old backup', names[i], err);
    }
  }
}

/** Write a core-only backup to the user's picked folder. Manual only. */
export async function writeBackupNow(): Promise<{ ok: true; filename: string } | { ok: false; reason: string }> {
  const handle = await getStoredHandle();
  if (!handle) return { ok: false, reason: 'No backup folder configured' };
  const permission = await queryHandlePermission(handle);
  if (permission !== 'granted') {
    return { ok: false, reason: `Folder permission is "${permission}". Click "Re-authorize" to fix.` };
  }
  try {
    const json = await timed('writeBackupNow (core)', () => exportCoreData());
    const filename = `tierlist-backup-${timestampForFilename()}.json`;
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(json);
    await writable.close();
    await setLastBackupAt(Date.now());
    await pruneOldBackups(handle);
    return { ok: true, filename };
  } catch (err) {
    console.warn('[auto-backup] writeBackupNow failed:', err);
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Manual core-only download to the Downloads folder. */
export async function downloadBackupNow(): Promise<{ ok: true; filename: string } | { ok: false; reason: string }> {
  try {
    const json = await timed('downloadBackupNow (core)', () => exportCoreData());
    const filename = `tierlist-backup-${timestampForFilename()}.json`;
    downloadExport(json, filename);
    await db.meta.put({ key: META_KEY_LAST_DOWNLOAD, value: Date.now() });
    return { ok: true, filename };
  } catch (err) {
    console.warn('[auto-backup] downloadBackupNow failed:', err);
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Manual full-with-images download. Slow for large collections; opt-in use only. */
export async function downloadFullBackupNow(): Promise<{ ok: true; filename: string } | { ok: false; reason: string }> {
  try {
    const json = await timed('downloadFullBackupNow (with images)', () => exportData());
    const filename = `tierlist-backup-full-${timestampForFilename()}.json`;
    downloadExport(json, filename);
    return { ok: true, filename };
  } catch (err) {
    console.warn('[auto-backup] downloadFullBackupNow failed:', err);
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
