import { useEffect, useState } from 'react';
import {
  currentSessionSamples, fmtMB, getSamples, memStats, slopePerHour,
  subscribeMemorySamples, suspects, takeSample, type MemSample,
} from '../../lib/memory-monitor';

/**
 * Floating memory readout. Toggle with Ctrl+Shift+M. Re-renders only on
 * each 30s sample (plus a live refresh every 5s while visible) so it costs
 * nothing meaningful itself.
 */
export function MemoryOverlay() {
  const [visible, setVisible] = useState(() => memStats.isOverlayOn());
  const [, setTick] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setVisible((v) => { memStats.setOverlay(!v); return !v; });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const unsub = subscribeMemorySamples(() => setTick((t) => t + 1));
    const live = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => { unsub(); clearInterval(live); };
  }, [visible]);

  if (!visible) return null;

  const now = takeSample();
  const session = currentSessionSamples(getSamples());
  const first = session[0] ?? now;
  const hours = (now.t - first.t) / 3_600_000;
  const heapPts = session.filter((s) => s.heapUsed != null).map((s) => ({ t: s.t, v: s.heapUsed as number }));
  const slope = slopePerHour(heapPts);
  const sus = suspects(session);

  const row = (label: string, v: number, base: number, warnAbove?: number) => {
    const d = v - base;
    const bad = warnAbove != null && v > warnAbove;
    return (
      <div className={`flex justify-between gap-3 ${bad ? 'text-red-400' : ''}`}>
        <span className="text-gray-400">{label}</span>
        <span>
          {v}
          <span className={`ml-1 ${d > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
            {d === 0 ? '' : `(${d > 0 ? '+' : ''}${d})`}
          </span>
        </span>
      </div>
    );
  };

  return (
    <div
      className="fixed bottom-2 right-2 z-[200] w-56 rounded border border-gray-700 bg-gray-900/95 p-2 font-mono text-[11px] text-gray-200 shadow-lg"
      title="Ctrl+Shift+M to hide. Console: memStats.report()"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold">Memory</span>
        <span className="text-gray-500">{hours.toFixed(1)}h · {session.length} samples</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-gray-400">JS heap</span>
        <span>
          {now.heapUsed == null ? 'n/a (Chrome only)' : fmtMB(now.heapUsed)}
        </span>
      </div>
      {now.heapUsed != null && (
        <div className="flex justify-between gap-3">
          <span className="text-gray-400">trend</span>
          <span className={slope != null && slope > 20 * 1024 * 1024 ? 'text-red-400' : ''}>
            {slope == null ? '…' : `${slope >= 0 ? '+' : ''}${fmtMB(slope)}/h`}
          </span>
        </div>
      )}
      {now.uaMemory != null && (
        <div className="flex justify-between gap-3">
          <span className="text-gray-400">UA memory</span><span>{fmtMB(now.uaMemory)}</span>
        </div>
      )}
      <div className="my-1 border-t border-gray-700" />
      {row('blob URLs', now.blobUrls, first.blobUrls)}
      {row('img cached', now.imgCached, first.imgCached)}
      {row('img subscribed', now.imgSubscribed, first.imgSubscribed)}
      {row('evict timers', now.imgEvictTimers, first.imgEvictTimers)}
      {row('undo', now.undoPast + now.undoRedo, first.undoPast + first.undoRedo, 100)}
      {row('sync dirty/flight', now.syncDirty + now.syncInFlight, first.syncDirty + first.syncInFlight)}
      {row('log buf', now.logMem, first.logMem, 200)}
      {row('DOM nodes', now.domNodes, first.domNodes)}
      <div className="my-1 border-t border-gray-700" />
      {sus.length === 0 ? (
        <div className="text-gray-500">no counter climbing</div>
      ) : (
        <div className="text-red-400">climbing: {sus.map((m: { metric: string }) => m.metric).join(', ')}</div>
      )}
    </div>
  );
}

export type { MemSample };
