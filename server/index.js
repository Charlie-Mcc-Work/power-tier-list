import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const SYNC_TOKEN = process.env.SYNC_TOKEN;
const DATA_DIR = process.env.DATA_DIR || './data';
const PUBLIC_DIR = process.env.PUBLIC_DIR || join(__dirname, 'public');
const SYNC_ENABLED = Boolean(SYNC_TOKEN);

if (!SYNC_ENABLED) {
  console.log(
    'INFO: SYNC_TOKEN is not set — running in open mode. Sync endpoints accept ' +
    'unauthenticated requests. Intended for private networks (Tailscale, LAN). ' +
    'Set SYNC_TOKEN to require Bearer auth.',
  );
}

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(`${DATA_DIR}/tierlist.db`);
db.pragma('journal_mode = WAL');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS tier_lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shares (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    mime_type TEXT,
    original_filename TEXT,
    created_at INTEGER,
    data_url TEXT NOT NULL
  );
`);

const app = express();
app.use(cors());
app.use(express.json({ limit: '200mb' }));

// Auth middleware for sync endpoints. If SYNC_TOKEN is unset the server runs
// in open mode — any request passes through. Intended for private networks
// (Tailscale, LAN) where Tailscale or the network boundary gates access.
function requireAuth(req, res, next) {
  if (!SYNC_ENABLED) return next();
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== SYNC_TOKEN) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  next();
}

// ── Sync endpoints (require auth) ──

// List all tier lists (metadata only)
app.get('/api/lists', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, updated_at, created_at FROM tier_lists ORDER BY updated_at DESC'
  ).all();
  res.json(rows);
});

// Get a tier list
app.get('/api/lists/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM tier_lists WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// Save/update a tier list
app.put('/api/lists/:id', requireAuth, (req, res) => {
  const { name, data } = req.body;
  if (!name || !data) return res.status(400).json({ error: 'name and data required' });

  const now = Date.now();
  const existing = db.prepare('SELECT id FROM tier_lists WHERE id = ?').get(req.params.id);

  if (existing) {
    db.prepare('UPDATE tier_lists SET name = ?, data = ?, updated_at = ? WHERE id = ?')
      .run(name, typeof data === 'string' ? data : JSON.stringify(data), now, req.params.id);
  } else {
    db.prepare('INSERT INTO tier_lists (id, name, data, updated_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(req.params.id, name, typeof data === 'string' ? data : JSON.stringify(data), now, now);
  }

  res.json({ id: req.params.id, updated_at: now });
});

// Delete a tier list
app.delete('/api/lists/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM tier_lists WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Image store ──
// Images are stored separately from list data, keyed by the client's image id
// (immutable per id — the client mints a fresh id when an image changes).
// Clients ask which ids are missing and upload only those, so routine list
// pushes carry no image payloads. Rows are shared across lists and kept even
// if no list currently references them.

// Which of these ids does the server not have yet?
app.post('/api/images/check', requireAuth, (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.filter((id) => typeof id === 'string')
    : null;
  if (!ids) return res.status(400).json({ error: 'ids array required' });
  const has = db.prepare('SELECT 1 FROM images WHERE id = ?');
  res.json({ missing: ids.filter((id) => !has.get(id)) });
});

app.put('/api/images/:id', requireAuth, (req, res) => {
  const { mimeType, originalFilename, createdAt, dataUrl } = req.body;
  if (typeof dataUrl !== 'string' || !dataUrl) {
    return res.status(400).json({ error: 'dataUrl required' });
  }
  // Immutable per id: a re-upload of an existing id is a no-op.
  db.prepare(`
    INSERT INTO images (id, mime_type, original_filename, created_at, data_url)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(req.params.id, mimeType ?? null, originalFilename ?? null, createdAt ?? Date.now(), dataUrl);
  res.json({ ok: true });
});

app.get('/api/images/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: row.id,
    mimeType: row.mime_type,
    originalFilename: row.original_filename,
    createdAt: row.created_at,
    dataUrl: row.data_url,
  });
});

// ── Share endpoints (public read) ──

// Create a share link (requires auth)
app.post('/api/share', requireAuth, (req, res) => {
  const { name, data } = req.body;
  if (!name || !data) return res.status(400).json({ error: 'name and data required' });

  const code = crypto.randomBytes(6).toString('base64url');
  db.prepare('INSERT INTO shares (code, name, data, created_at) VALUES (?, ?, ?, ?)')
    .run(code, name, typeof data === 'string' ? data : JSON.stringify(data), Date.now());

  res.json({ code, url: `/shared/${code}` });
});

// Get a shared tier list (public, no auth)
app.get('/api/shared/:code', (req, res) => {
  const row = db.prepare('SELECT * FROM shares WHERE code = ?').get(req.params.code);
  if (!row) return res.status(404).json({ error: 'Share not found' });
  res.json(row);
});

// Health check. `requiresAuth: false` tells the client it can push/pull
// without a token (server is in open mode).
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    requiresAuth: SYNC_ENABLED,
    lists: db.prepare('SELECT COUNT(*) as count FROM tier_lists').get(),
  });
});

// ── Serve the built frontend (when present). Enables a single-container deploy:
// `/api/*` hits the API above, everything else falls through to the SPA. ──
if (existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, { maxAge: '1d', index: 'index.html' }));

  // SPA fallback: any non-API GET that isn't a real file should return index.html
  // so client-side routing works. Express 5 uses path-to-regexp v6, which doesn't
  // accept bare `*` — use a regex instead.
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    const indexPath = join(PUBLIC_DIR, 'index.html');
    if (existsSync(indexPath)) return res.sendFile(indexPath);
    next();
  });
  console.log(`Serving frontend from ${PUBLIC_DIR}`);
} else {
  console.log(`No frontend found at ${PUBLIC_DIR} — running as API-only server.`);
}

app.listen(PORT, HOST, () => {
  console.log(`Tier List server running on ${HOST}:${PORT} (sync ${SYNC_ENABLED ? 'enabled' : 'disabled'})`);
});
