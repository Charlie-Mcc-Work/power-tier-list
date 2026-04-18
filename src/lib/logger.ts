export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
  data?: unknown;
}

// In-memory buffer for the current session
const memBuffer: LogEntry[] = [];
const MAX_MEM = 200;

// IndexedDB for persistent storage (errors and warnings only — info is too noisy)
const DB_NAME = 'PowerTierListLogs';
const STORE_NAME = 'logs';
const MAX_PERSISTED = 500;
let dbReady: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Initialize DB connection
openDB().then((db) => { dbReady = db; }).catch(() => {});

function persistEntry(entry: LogEntry) {
  if (!dbReady) return;
  try {
    const tx = dbReady.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(entry);

    // Prune old entries: count and delete oldest if over limit
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result > MAX_PERSISTED) {
        const cursorReq = store.openCursor();
        let toDelete = countReq.result - MAX_PERSISTED;
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor && toDelete > 0) {
            cursor.delete();
            toDelete--;
            cursor.continue();
          }
        };
      }
    };
  } catch {
    // Don't let logging failures break the app
  }
}

function add(level: LogEntry['level'], source: string, message: string, data?: unknown) {
  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    level,
    source,
    message,
    data,
  };

  memBuffer.push(entry);
  if (memBuffer.length > MAX_MEM) memBuffer.shift();

  // Persist errors and warnings to IndexedDB
  if (level === 'error' || level === 'warn') {
    persistEntry(entry);
  }

  const prefix = `[${source}]`;
  if (level === 'error') {
    console.error(prefix, message, data ?? '');
  } else if (level === 'warn') {
    console.warn(prefix, message, data ?? '');
  }
}

async function getPersistedEntries(): Promise<LogEntry[]> {
  if (!dbReady) {
    try { dbReady = await openDB(); } catch { return []; }
  }
  return new Promise((resolve) => {
    try {
      const tx = dbReady!.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function clearPersisted(): Promise<void> {
  if (!dbReady) return;
  try {
    const tx = dbReady.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
  } catch {
    // ignore
  }
}

function formatEntries(entries: LogEntry[]): string {
  return entries.map((e) =>
    `[${new Date(e.timestamp).toISOString()}] ${e.level.toUpperCase()} ${e.source}: ${e.message}${e.data ? ' ' + JSON.stringify(e.data) : ''}`
  ).join('\n');
}

export const log = {
  error: (source: string, message: string, data?: unknown) => add('error', source, message, data),
  warn: (source: string, message: string, data?: unknown) => add('warn', source, message, data),
  info: (source: string, message: string, data?: unknown) => add('info', source, message, data),

  /** Current session entries (in-memory, all levels) */
  getEntries: () => [...memBuffer],

  /** All persisted errors/warnings across sessions */
  getHistory: () => getPersistedEntries(),

  /** Format entries as readable text */
  format: (entries: LogEntry[]) => formatEntries(entries),

  /** Clear in-memory buffer */
  clear: () => { memBuffer.length = 0; },

  /** Clear persisted log history */
  clearHistory: () => clearPersisted(),
};

// Expose globally for console access
// appLog.getEntries()         — current session (all levels)
// appLog.getHistory()         — persisted errors/warnings (returns Promise)
// appLog.format(entries)      — format as text
// appLog.clearHistory()       — wipe persisted logs
(window as unknown as Record<string, unknown>).appLog = log;
