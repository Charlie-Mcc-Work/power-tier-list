import { describe, it, expect } from 'vitest';
import { slopePerHour, summarize, suspects, currentSessionSamples, SAMPLE_INTERVAL_MS, type MemSample } from './memory-monitor';

function mk(i: number, over: Partial<MemSample> = {}): MemSample {
  return {
    t: i * SAMPLE_INTERVAL_MS, heapUsed: null, heapTotal: null, uaMemory: null,
    blobUrls: 10, imgCached: 10, imgWithUrl: 10, imgSubscribed: 10, imgEvictTimers: 0,
    undoPast: 0, undoRedo: 0, syncDirty: 0, syncInFlight: 0, logMem: 5, domNodes: 500, rootNodes: 480,
    ...over,
  };
}

describe('memory-monitor analysis', () => {
  it('computes slope in units per hour', () => {
    const pts = [0, 1, 2, 3].map((i) => ({ t: i * 3_600_000, v: 100 + i * 50 }));
    expect(slopePerHour(pts)).toBeCloseTo(50);
    expect(slopePerHour(pts.slice(0, 1))).toBeNull();
  });

  it('flags a monotonically climbing counter and ignores flat/fluctuating ones', () => {
    const list = Array.from({ length: 40 }, (_, i) =>
      mk(i, { blobUrls: 10 + i * 5, imgCached: 10 + (i % 3) * 20, domNodes: 500 }));
    const sus = suspects(list).map((m) => m.metric);
    expect(sus).toEqual(['blobUrls']);
    const blob = summarize(list).find((m) => m.metric === 'blobUrls')!;
    expect(blob.first).toBe(10);
    expect(blob.last).toBe(10 + 39 * 5);
    expect(blob.monotonic).toBe(1);
  });

  it('never reports heap itself as a suspect (it is the symptom)', () => {
    const list = Array.from({ length: 20 }, (_, i) => mk(i, { heapUsed: 1e6 * (i + 1) }));
    expect(suspects(list)).toEqual([]);
  });

  it('splits the current session at a gap in sampling', () => {
    const a = [0, 1, 2].map((i) => mk(i));
    const b = [100, 101].map((i) => mk(i));
    expect(currentSessionSamples([...a, ...b])).toHaveLength(2);
    expect(currentSessionSamples(a)).toHaveLength(3);
  });
});
