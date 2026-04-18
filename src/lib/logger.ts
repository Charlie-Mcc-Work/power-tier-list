export interface LogEntry {
  timestamp: number;
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
  data?: unknown;
}

const MAX_ENTRIES = 200;
const entries: LogEntry[] = [];

function add(level: LogEntry['level'], source: string, message: string, data?: unknown) {
  const entry: LogEntry = { timestamp: Date.now(), level, source, message, data };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  // Also log to console for dev tools visibility
  const prefix = `[${source}]`;
  if (level === 'error') {
    console.error(prefix, message, data ?? '');
  } else if (level === 'warn') {
    console.warn(prefix, message, data ?? '');
  }
}

export const log = {
  error: (source: string, message: string, data?: unknown) => add('error', source, message, data),
  warn: (source: string, message: string, data?: unknown) => add('warn', source, message, data),
  info: (source: string, message: string, data?: unknown) => add('info', source, message, data),
  getEntries: () => [...entries],
  clear: () => { entries.length = 0; },
};

// Expose globally so we can inspect from the browser console: appLog.getEntries()
(window as unknown as Record<string, unknown>).appLog = log;
