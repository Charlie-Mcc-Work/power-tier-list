/**
 * Memory monitor.
 *
 * Periodically samples the JS heap (where the browser exposes it) plus a set
 * of in-app counters that correspond to every place this app has ever leaked
 * or could plausibly leak: live blob URLs, the image cache, undo history,
 * sync queues, the log buffer, DOM node count. Samples are kept in a ring in
 * memory AND mirrored to localStorage so a crashed/reloaded tab still has its
 * history.
 *
 * Why counters and not just heap: a heap number tells you *that* memory is
 * growing; a counter that grows in lockstep tells you *where*. Every counter
 * here should stay flat (or bounded) over a long session. One that climbs
 * monotonically is the leak.
 *
 * Console API (window.memStats):
 *   memStats.now()      — current sample
 *   memStats.report()   — console.table of first/last/max per metric, heap
 *                         growth rate, and which counters are climbing
 *   memStats.samples()  — raw sample array
 *   memStats.dump()     — JSON string of all samples (paste into a file)
 *   memStats.reset()    — clear history
 *   memStats.gc()       — window.gc() if Chrome was launched with
 *                         --js-flags=--expose-gc, else no-op
 *
 * No UI — this is a console-only diagnostic. Call memStats.report() in
 * DevTools when hunting a leak.
 */

import { getImageCacheStats } from '../hooks/use-image';
import { undoManager } from './undo';
import { getSyncQueueStats } from './sync';
import { log } from './logger';

export const SAMPLE_INTERVAL_MS = 30_000;
const MAX_SAMPLES = 2_000; // ~16h at 30s
const STORAGE_KEY = 'ptl_mem_samples';

export interface MemSample {
  t: number;
  /** Chrome-only performance.memory; null on Firefox/Safari. */
  heapUsed: number | null;
  heapTotal: number | null;
  /** performance.measureUserAgentSpecificMemory(); needs crossOriginIsolated. */
  uaMemory: number | null;
  blobUrls: number;
  imgCached: number;
  imgWithUrl: number;
  imgSubscribed: number;
  imgEvictTimers: number;
  undoPast: number;
  undoRedo: number;
  syncDirty: number;
  syncInFlight: number;
  logMem: number;
  domNodes: number;
  /** Cheap proxy for React fibre count: elements under #root. */
  rootNodes: number;
}

// ── Blob URL accounting ────────────────────────────────────────────────────
// Every object URL pins its blob. We wrap the two URL statics once so the
// count is exact regardless of who minted the URL.

const liveBlobUrls = new Set<string>();
let patched = false;

function patchBlobUrls() {
  if (patched || typeof URL === 'undefined') return;
  patched = true;
  const origCreate = URL.createObjectURL.bind(URL);
  const origRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const u = origCreate(obj);
    liveBlobUrls.add(u);
    return u;
  };
  URL.revokeObjectURL = (u: string) => {
    liveBlobUrls.delete(u);
    origRevoke(u);
  };
}

// ── Sampling ───────────────────────────────────────────────────────────────

let samples: MemSample[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
let uaMemoryInFlight = false;
let lastUaMemory: number | null = null;

function loadPersisted(): MemSample[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
  } catch {
    // Quota — drop the oldest half and try once more; if that fails, give up
    // silently. The in-memory ring still works.
    try {
      samples = samples.slice(Math.floor(samples.length / 2));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
    } catch { /* ignore */ }
  }
}

type PerfWithMemory = Performance & {
  memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
};

export function takeSample(): MemSample {
  const perf = performance as PerfWithMemory;
  const mem = perf.memory;
  const img = getImageCacheStats();
  const undo = undoManager.getState();
  const sync = getSyncQueueStats();
  const root = document.getElementById('root');
  return {
    t: Date.now(),
    heapUsed: mem ? mem.usedJSHeapSize : null,
    heapTotal: mem ? mem.totalJSHeapSize : null,
    uaMemory: lastUaMemory,
    blobUrls: liveBlobUrls.size,
    imgCached: img.cached,
    imgWithUrl: img.withUrl,
    imgSubscribed: img.subscribed,
    imgEvictTimers: img.evictTimers,
    undoPast: undo.undoCount,
    undoRedo: undo.redoCount,
    syncDirty: sync.dirty,
    syncInFlight: sync.inFlight,
    logMem: log.getEntries().length,
    domNodes: document.getElementsByTagName('*').length,
    rootNodes: root ? root.getElementsByTagName('*').length : 0,
  };
}

function refreshUaMemory() {
  const perf = performance as PerfWithMemory;
  if (!perf.measureUserAgentSpecificMemory || !crossOriginIsolated || uaMemoryInFlight) return;
  uaMemoryInFlight = true;
  perf.measureUserAgentSpecificMemory()
    .then((r) => { lastUaMemory = r.bytes; })
    .catch(() => { /* not available */ })
    .finally(() => { uaMemoryInFlight = false; });
}

function tick() {
  refreshUaMemory();
  const s = takeSample();
  samples.push(s);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  persist();
  for (const fn of listeners) fn();
}

export function startMemoryMonitor() {
  if (timer != null) return;
  patchBlobUrls();
  samples = loadPersisted();
  // Mark a session boundary so report() can tell reloads apart.
  tick();
  timer = setInterval(tick, SAMPLE_INTERVAL_MS);
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).memStats = memStats;
  }
}

export function stopMemoryMonitor() {
  if (timer != null) clearInterval(timer);
  timer = null;
}

export function subscribeMemorySamples(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getSamples(): MemSample[] {
  return samples;
}

// ── Analysis ───────────────────────────────────────────────────────────────

export interface MetricSummary {
  metric: string;
  first: number | null;
  last: number | null;
  max: number | null;
  /** Least-squares slope in units per hour. */
  perHour: number | null;
  /** Fraction of consecutive deltas that were >= 0 (1 = never went down). */
  monotonic: number | null;
}

const COUNTER_KEYS: Array<keyof MemSample> = [
  'heapUsed', 'heapTotal', 'uaMemory', 'blobUrls', 'imgCached', 'imgWithUrl',
  'imgSubscribed', 'imgEvictTimers', 'undoPast', 'undoRedo', 'syncDirty',
  'syncInFlight', 'logMem', 'domNodes', 'rootNodes',
];

export function slopePerHour(points: Array<{ t: number; v: number }>): number | null {
  if (points.length < 2) return null;
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / 3_600_000);
  const ys = points.map((p) => p.v);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

export function summarize(list: MemSample[]): MetricSummary[] {
  return COUNTER_KEYS.map((key) => {
    const pts = list
      .filter((s) => typeof s[key] === 'number')
      .map((s) => ({ t: s.t, v: s[key] as number }));
    if (pts.length === 0) {
      return { metric: key, first: null, last: null, max: null, perHour: null, monotonic: null };
    }
    let ups = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i].v >= pts[i - 1].v) ups++;
    return {
      metric: key,
      first: pts[0].v,
      last: pts[pts.length - 1].v,
      max: Math.max(...pts.map((p) => p.v)),
      perHour: slopePerHour(pts),
      monotonic: pts.length > 1 ? ups / (pts.length - 1) : null,
    };
  });
}

/** Counters that grew meaningfully and almost never shrank — the suspects. */
export function suspects(list: MemSample[]): MetricSummary[] {
  return summarize(list).filter((m) => {
    if (m.first == null || m.last == null || m.monotonic == null) return false;
    if (m.metric.startsWith('heap') || m.metric === 'uaMemory') return false;
    const grew = m.last - m.first;
    return grew > Math.max(10, m.first * 0.5) && m.monotonic >= 0.9;
  });
}

const MB = 1024 * 1024;
export const fmtMB = (b: number | null) => (b == null ? 'n/a' : `${(b / MB).toFixed(1)} MB`);

/** Samples from the current page load only (after the last gap > 2 intervals). */
export function currentSessionSamples(list: MemSample[]): MemSample[] {
  for (let i = list.length - 1; i > 0; i--) {
    if (list[i].t - list[i - 1].t > SAMPLE_INTERVAL_MS * 2.5) return list.slice(i);
  }
  return list;
}

function report(scope: 'session' | 'all' = 'session') {
  const list = scope === 'all' ? samples : currentSessionSamples(samples);
  if (list.length === 0) { console.log('[memStats] no samples yet'); return; }
  const first = list[0];
  const last = list[list.length - 1];
  const hours = (last.t - first.t) / 3_600_000;
  const heapPts = list.filter((s) => s.heapUsed != null).map((s) => ({ t: s.t, v: s.heapUsed as number }));
  const heapSlope = slopePerHour(heapPts);

  console.group(`[memStats] ${scope}: ${list.length} samples over ${hours.toFixed(2)}h`);
  if (first.heapUsed == null) {
    console.log('Heap size not exposed by this browser (performance.memory is Chrome-only). '
      + 'Use about:memory (Firefox) or the OS task manager for the process total; '
      + 'the counters below still identify the source.');
  } else {
    console.log(`Heap used: ${fmtMB(first.heapUsed)} → ${fmtMB(last.heapUsed)} `
      + `(peak ${fmtMB(Math.max(...heapPts.map((p) => p.v)))}), `
      + `trend ${heapSlope == null ? 'n/a' : fmtMB(heapSlope) + '/hour'}`);
  }
  console.table(summarize(list).map((m) => ({
    metric: m.metric,
    first: m.first, last: m.last, max: m.max,
    perHour: m.perHour == null ? null : Number(m.perHour.toFixed(2)),
    monotonic: m.monotonic == null ? null : Number(m.monotonic.toFixed(2)),
  })));
  const sus = suspects(list);
  if (sus.length === 0) {
    console.log('No in-app counter is climbing. If heap still grows, the growth is outside '
      + 'the instrumented structures (check DevTools → Memory → heap snapshot diff).');
  } else {
    console.warn('Suspects (grew and never shrank):', sus.map((m) => `${m.metric} ${m.first}→${m.last}`).join(', '));
  }
  console.groupEnd();
}

export const memStats = {
  now: () => takeSample(),
  samples: () => samples,
  report,
  dump: () => JSON.stringify(samples),
  reset: () => { samples = []; persist(); for (const fn of listeners) fn(); },
  gc: () => {
    const g = (window as unknown as { gc?: () => void }).gc;
    if (g) { g(); console.log('[memStats] gc() called'); } else {
      console.log('[memStats] window.gc unavailable (launch Chrome with --js-flags=--expose-gc)');
    }
  },
};
