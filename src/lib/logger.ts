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
const FLUSH_INTERVAL_MS = 2000;
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
openDB()
  .then((db) => { dbReady = db; })
  .catch((err) => console.warn('[logger] IndexedDB unavailable:', err));

// Writes are batched: a burst of errors produces one transaction per flush
// interval instead of one transaction per log call. Pruning runs at the end
// of a flush rather than after every single write.
const pendingWrites: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPending();
  }, FLUSH_INTERVAL_MS);
}

function flushPending() {
  if (!dbReady || pendingWrites.length === 0) return;
  const batch = pendingWrites.splice(0, pendingWrites.length);
  try {
    const tx = dbReady.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const entry of batch) store.put(entry);

    tx.oncomplete = () => {
      // Prune once per flush instead of per entry.
      if (!dbReady) return;
      const ptx = dbReady.transaction(STORE_NAME, 'readwrite');
      const pstore = ptx.objectStore(STORE_NAME);
      const countReq = pstore.count();
      countReq.onsuccess = () => {
        if (countReq.result > MAX_PERSISTED) {
          let toDelete = countReq.result - MAX_PERSISTED;
          const cursorReq = pstore.openCursor();
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
    };
  } catch (err) {
    console.warn('[logger] flush failed:', err);
  }
}

// Flush when the tab is hidden or being closed so entries from the final
// error burst still make it to disk.
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPending();
  });
  window.addEventListener('pagehide', () => flushPending());
}

function persistEntry(entry: LogEntry) {
  pendingWrites.push(entry);
  scheduleFlush();
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
    try {
      dbReady = await openDB();
    } catch (err) {
      console.warn('[logger] getHistory: IndexedDB unavailable:', err);
      return [];
    }
  }
  // Flush any in-flight writes so the history reflects recent events.
  flushPending();
  return new Promise((resolve) => {
    try {
      const tx = dbReady!.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => {
        console.warn('[logger] getHistory request failed:', req.error);
        resolve([]);
      };
    } catch (err) {
      console.warn('[logger] getHistory transaction failed:', err);
      resolve([]);
    }
  });
}

async function clearPersisted(): Promise<void> {
  if (!dbReady) return;
  pendingWrites.length = 0;
  try {
    const tx = dbReady.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
  } catch (err) {
    console.warn('[logger] clearHistory failed:', err);
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
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).appLog = log;
}
