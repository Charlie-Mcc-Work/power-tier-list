import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import dagre from '@dagrejs/dagre';
import type { Relationship, Character, TierList } from '../../types';
import { DEFAULT_TIER_DEFS } from '../../types';

interface Props {
  relationships: Relationship[];
  characters: Character[];
  tierList: TierList | undefined;
}

type LayoutMode = 'tier' | 'dag';

interface LayoutNode {
  id: string;
  name: string;
  x: number; // center
  y: number;
  width: number;
  height: number;
  tierId: string; // '__unranked' if not placed
}

interface LayoutEdge {
  from: string;
  to: string;
  strict: boolean;
  points: Array<{ x: number; y: number }>;
}

interface TierBand {
  id: string;
  label: string;
  color: string;
  y: number; // top
  height: number;
  count: number;
}

interface ComputedLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  bands: TierBand[];
  width: number;
  height: number;
}

const NODE_WIDTH = 120;
const NODE_HEIGHT = 36;
const NODE_GAP_X = 16;
const ROW_HEIGHT = 80;
const ROW_LABEL_WIDTH = 56;
const ROW_PAD_LEFT = 8;
const ROW_PAD_RIGHT = 24;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2;
const UNRANKED_ID = '__unranked';

/**
 * Compute the endpoint where a line leaving a node's center in direction (dx,dy)
 * exits the node's rectangle. Used so arrowheads land on the node outline
 * instead of being hidden behind it.
 */
function boxEdgeExit(
  cx: number, cy: number, w: number, h: number,
  dx: number, dy: number,
): { x: number; y: number } {
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const halfW = w / 2;
  const halfH = h / 2;
  // Parametric t where the ray hits each edge; the smallest positive wins.
  const candidates: number[] = [];
  if (dx !== 0) {
    candidates.push((dx > 0 ? halfW : -halfW) / dx);
  }
  if (dy !== 0) {
    candidates.push((dy > 0 ? halfH : -halfH) / dy);
  }
  const t = Math.min(...candidates.filter((v) => v > 0));
  return { x: cx + dx * t, y: cy + dy * t };
}

export function GraphView({ relationships, characters, tierList }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [mode, setMode] = useState<LayoutMode>('tier');
  // Bumped whenever the container resizes so the draw effect re-fires.
  const [resizeTick, setResizeTick] = useState(0);
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const charMap = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters],
  );

  /**
   * DAG layout — dagre-computed topological layering. Each rank is whatever
   * dagre thinks fits best; no relationship to your tier assignments.
   * Shows the structure of the relationship graph in isolation.
   */
  const dagLayout = useMemo<ComputedLayout | null>(() => {
    if (relationships.length === 0) return null;
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', ranksep: 60, nodesep: 30 });
    g.setDefaultEdgeLabel(() => ({}));

    const inGraph = new Set<string>();
    for (const rel of relationships) {
      inGraph.add(rel.superiorId);
      inGraph.add(rel.inferiorId);
    }
    for (const id of inGraph) {
      const name = charMap.get(id)?.name ?? id.slice(0, 8);
      g.setNode(id, { label: name, width: NODE_WIDTH, height: NODE_HEIGHT });
    }
    for (const rel of relationships) {
      g.setEdge(rel.superiorId, rel.inferiorId, { strict: rel.strict ?? false });
    }
    dagre.layout(g);

    const nodes: LayoutNode[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of g.nodes()) {
      const n = g.node(id);
      if (!n) continue;
      const w = n.width ?? NODE_WIDTH;
      const h = n.height ?? NODE_HEIGHT;
      minX = Math.min(minX, n.x - w / 2);
      minY = Math.min(minY, n.y - h / 2);
      maxX = Math.max(maxX, n.x + w / 2);
      maxY = Math.max(maxY, n.y + h / 2);
      nodes.push({
        id,
        name: (n as Record<string, unknown>).label as string ?? id,
        x: n.x,
        y: n.y,
        width: w,
        height: h,
        tierId: '__dag', // DAG mode ignores tier groupings
      });
    }

    const edges: LayoutEdge[] = [];
    for (const e of g.edges()) {
      const edgeData = g.edge(e);
      const pts = edgeData.points ?? [];
      edges.push({
        from: e.v,
        to: e.w,
        strict: (edgeData as { strict?: boolean }).strict ?? false,
        points: pts,
      });
    }

    return {
      nodes,
      edges,
      bands: [],
      width: isFinite(maxX) ? maxX - minX : 0,
      height: isFinite(maxY) ? maxY - minY : 0,
    };
  }, [relationships, charMap]);

  /**
   * Tier-layered layout. Each tier in `tierDefs` order gets a horizontal row;
   * nodes assigned to that tier sit at the same y. An "Unranked" row at the
   * bottom catches characters that appear in a relationship but aren't
   * placed in any tier.
   */
  const tierLayout = useMemo<ComputedLayout | null>(() => {
    if (relationships.length === 0) return null;

    const tierDefs = tierList?.tierDefs ?? DEFAULT_TIER_DEFS;
    const assignments = tierList?.tiers ?? [];

    // charId -> tierId (only for characters that are assigned)
    const charTier = new Map<string, string>();
    // charId -> position within tier (for stable ordering)
    const charPos = new Map<string, number>();
    for (const a of assignments) {
      charTier.set(a.characterId, a.tier);
      charPos.set(a.characterId, a.position);
    }

    // Which characters actually appear in the graph (endpoints of any relationship)
    const inGraph = new Set<string>();
    for (const rel of relationships) {
      inGraph.add(rel.superiorId);
      inGraph.add(rel.inferiorId);
    }

    // Valid tier ids (the rest go to Unranked)
    const validTierIds = new Set(tierDefs.map((t) => t.id));

    // Group by tier
    const byTier = new Map<string, string[]>();
    const unranked: string[] = [];
    for (const id of inGraph) {
      const tier = charTier.get(id);
      if (tier && validTierIds.has(tier)) {
        if (!byTier.has(tier)) byTier.set(tier, []);
        byTier.get(tier)!.push(id);
      } else {
        unranked.push(id);
      }
    }

    // Sort each tier by the user-chosen in-tier position; sort Unranked alphabetically.
    for (const ids of byTier.values()) {
      ids.sort((a, b) => (charPos.get(a) ?? 0) - (charPos.get(b) ?? 0));
    }
    unranked.sort((a, b) =>
      (charMap.get(a)?.name ?? '').localeCompare(charMap.get(b)?.name ?? ''),
    );

    // Build rows, skipping empty tiers (keeps the picture tight).
    const rows: Array<{ id: string; label: string; color: string; ids: string[] }> = [];
    for (const t of tierDefs) {
      const ids = byTier.get(t.id);
      if (!ids || ids.length === 0) continue;
      rows.push({ id: t.id, label: t.name, color: t.color, ids });
    }
    if (unranked.length > 0) {
      rows.push({ id: UNRANKED_ID, label: 'Unranked', color: '#404040', ids: unranked });
    }

    // Lay nodes out row by row
    const nodes: LayoutNode[] = [];
    const bands: TierBand[] = [];
    let y = 0;
    let maxRightEdge = 0;
    for (const row of rows) {
      const rowTop = y;
      const rowCenterY = y + ROW_HEIGHT / 2;
      row.ids.forEach((id, i) => {
        const nodeCenterX =
          ROW_LABEL_WIDTH + ROW_PAD_LEFT + NODE_WIDTH / 2 + i * (NODE_WIDTH + NODE_GAP_X);
        nodes.push({
          id,
          name: charMap.get(id)?.name ?? id,
          x: nodeCenterX,
          y: rowCenterY,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          tierId: row.id,
        });
      });
      const rowRight =
        ROW_LABEL_WIDTH + ROW_PAD_LEFT + row.ids.length * (NODE_WIDTH + NODE_GAP_X) + ROW_PAD_RIGHT;
      maxRightEdge = Math.max(maxRightEdge, rowRight);
      bands.push({
        id: row.id,
        label: row.label,
        color: row.color,
        y: rowTop,
        height: ROW_HEIGHT,
        count: row.ids.length,
      });
      y += ROW_HEIGHT;
    }

    // Build edges with endpoints on node outlines so arrowheads are visible.
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const edges: LayoutEdge[] = [];
    for (const rel of relationships) {
      const from = nodeById.get(rel.superiorId);
      const to = nodeById.get(rel.inferiorId);
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const ux = dx / len;
      const uy = dy / len;
      const start = boxEdgeExit(from.x, from.y, from.width, from.height, ux, uy);
      const end = boxEdgeExit(to.x, to.y, to.width, to.height, -ux, -uy);
      edges.push({
        from: rel.superiorId,
        to: rel.inferiorId,
        strict: rel.strict ?? false,
        points: [start, end],
      });
    }

    return {
      nodes,
      edges,
      bands,
      width: Math.max(maxRightEdge, ROW_LABEL_WIDTH + 200),
      height: y,
    };
  }, [relationships, charMap, tierList]);

  // Active layout for the rest of the component.
  const layout = mode === 'tier' ? tierLayout : dagLayout;

  const fitToView = useCallback(() => {
    if (!layout || !containerRef.current) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const pad = 24;
    const fitZoom = Math.min(
      (cw - pad * 2) / Math.max(layout.width, 1),
      (ch - pad * 2) / Math.max(layout.height, 1),
      // Small view: never zoom past 1. Fullscreen: allow up to 2 so small graphs don't look lost.
      fullscreen ? 2 : 1,
    );
    setZoom(fitZoom);
    setPan({
      x: (cw - layout.width * fitZoom) / 2,
      y: (ch - layout.height * fitZoom) / 2,
    });
  }, [layout, fullscreen]);

  // Auto-fit when layout first becomes available or when the fullscreen
  // toggle changes the container size.
  useEffect(() => {
    const id = requestAnimationFrame(fitToView);
    return () => cancelAnimationFrame(id);
  }, [layout, fullscreen, fitToView]);

  // Resize observer → trigger redraw on any container size change.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => setResizeTick((t) => t + 1));
    ro.observe(container);
    return () => ro.disconnect();
  }, [fullscreen]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !layout) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.style.width = `${container.clientWidth}px`;
    canvas.style.height = `${container.clientHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // --- Tier bands: faint row backgrounds + colored tier label on the left
    for (const band of layout.bands) {
      // Row tint (alternating subtle bg for readability)
      const isUnranked = band.id === UNRANKED_ID;
      ctx.fillStyle = isUnranked ? 'rgba(64,64,64,0.10)' : 'rgba(255,255,255,0.025)';
      ctx.fillRect(ROW_LABEL_WIDTH, band.y, layout.width - ROW_LABEL_WIDTH, band.height);

      // Tier-color label box on the left
      const labelPad = 4;
      const labelH = band.height - labelPad * 2;
      ctx.fillStyle = band.color;
      ctx.beginPath();
      ctx.roundRect(labelPad, band.y + labelPad, ROW_LABEL_WIDTH - labelPad * 2, labelH, 4);
      ctx.fill();

      ctx.fillStyle = isUnranked ? '#bbb' : '#141414';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(band.label, ROW_LABEL_WIDTH / 2, band.y + band.height / 2 - 6);

      // Count underneath
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = isUnranked ? 'rgba(187,187,187,0.6)' : 'rgba(20,20,20,0.6)';
      ctx.fillText(`${band.count}`, ROW_LABEL_WIDTH / 2, band.y + band.height / 2 + 9);
    }

    // Row separators
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (const band of layout.bands) {
      ctx.beginPath();
      ctx.moveTo(0, band.y);
      ctx.lineTo(layout.width, band.y);
      ctx.stroke();
    }
    // Final separator at the bottom of the last band
    if (layout.bands.length > 0) {
      const last = layout.bands[layout.bands.length - 1];
      ctx.beginPath();
      ctx.moveTo(0, last.y + last.height);
      ctx.lineTo(layout.width, last.y + last.height);
      ctx.stroke();
    }

    // --- Edges
    for (const edge of layout.edges) {
      ctx.beginPath();
      ctx.strokeStyle = edge.strict ? '#d97706' : 'rgba(120,120,120,0.7)';
      ctx.lineWidth = edge.strict ? 1.6 : 1.1;
      const pts = edge.points;
      if (pts.length === 0) continue;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();

      if (pts.length >= 2) {
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
        const size = 7;
        ctx.beginPath();
        ctx.fillStyle = edge.strict ? '#d97706' : 'rgba(120,120,120,0.85)';
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(last.x - size * Math.cos(angle - 0.4), last.y - size * Math.sin(angle - 0.4));
        ctx.lineTo(last.x - size * Math.cos(angle + 0.4), last.y - size * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fill();
      }
    }

    // --- Nodes (drawn last so they sit above edges)
    const maxChars = Math.max(
      8,
      Math.floor((fullscreen ? 22 : 14) * Math.max(zoom, 0.6)),
    );
    for (const node of layout.nodes) {
      const x = node.x - node.width / 2;
      const y = node.y - node.height / 2;
      ctx.fillStyle = '#1e1e1e';
      ctx.strokeStyle = '#3a3a3a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, node.width, node.height, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#e5e5e5';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const displayName =
        node.name.length > maxChars ? node.name.slice(0, maxChars - 1) + '…' : node.name;
      ctx.fillText(displayName, node.x, node.y);
    }

    ctx.restore();
  }, [layout, pan, zoom, resizeTick, fullscreen]);

  // Keyboard shortcuts while fullscreen is open.
  useEffect(() => {
    if (!fullscreen) return;
    const PAN_STEP = 60;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setFullscreen(false);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP));
      } else if (e.key === '0' || e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        fitToView();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPan((p) => ({ ...p, y: p.y + PAN_STEP }));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPan((p) => ({ ...p, y: p.y - PAN_STEP }));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPan((p) => ({ ...p, x: p.x + PAN_STEP }));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPan((p) => ({ ...p, x: p.x - PAN_STEP }));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, fitToView]);

  function handleMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    e.preventDefault();
    lastMouse.current = { x: e.clientX, y: e.clientY };
    dragging.current = true;

    function onMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const dx = ev.clientX - lastMouse.current.x;
      const dy = ev.clientY - lastMouse.current.y;
      lastMouse.current = { x: ev.clientX, y: ev.clientY };
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
    function onUp() {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function handleWheel(e: React.WheelEvent) {
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (e.ctrlKey || e.metaKey) {
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
      const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * delta));
      if (newZoom === zoom) return;
      const k = newZoom / zoom;
      setZoom(newZoom);
      setPan({
        x: mx - (mx - pan.x) * k,
        y: my - (my - pan.y) * k,
      });
    } else {
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      setPan((p) => ({ x: p.x - dx, y: p.y - dy }));
    }
  }

  if (!layout || layout.nodes.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4">
        Add relationships to see the graph.
      </p>
    );
  }

  const zoomPct = Math.round(zoom * 100);

  const toolbar = (
    <div className="flex items-center gap-1 text-xs">
      <div
        className="flex items-center rounded border border-gray-600 overflow-hidden mr-1"
        role="group"
        aria-label="Layout mode"
      >
        <button
          onClick={() => setMode('tier')}
          className={`h-7 px-2 text-[11px] transition-colors ${
            mode === 'tier'
              ? 'bg-amber-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
          title="Nodes grouped into rows by their tier assignment (S on top, F at bottom)"
          type="button"
        >
          Tier
        </button>
        <button
          onClick={() => setMode('dag')}
          className={`h-7 px-2 text-[11px] transition-colors ${
            mode === 'dag'
              ? 'bg-amber-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
          title="Auto-layered DAG layout (dagre) — shows the relationship structure, ignores tier assignments"
          type="button"
        >
          DAG
        </button>
      </div>
      <button
        onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP))}
        className="w-7 h-7 flex items-center justify-center rounded border border-gray-600 text-gray-300
                   hover:bg-gray-700 hover:text-white transition-colors"
        title="Zoom out (−)"
        type="button"
      >
        −
      </button>
      <span className="min-w-[3ch] text-center tabular-nums text-gray-400 select-none">
        {zoomPct}%
      </span>
      <button
        onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP))}
        className="w-7 h-7 flex items-center justify-center rounded border border-gray-600 text-gray-300
                   hover:bg-gray-700 hover:text-white transition-colors"
        title="Zoom in (+)"
        type="button"
      >
        +
      </button>
      <button
        onClick={fitToView}
        className="h-7 px-2 rounded border border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white
                   transition-colors"
        title="Fit to view (F or 0)"
        type="button"
      >
        Fit
      </button>
      <button
        onClick={() => setFullscreen((v) => !v)}
        className="h-7 px-2 rounded border border-amber-700/60 text-amber-300 hover:bg-amber-900/30
                   transition-colors"
        title={fullscreen ? 'Exit fullscreen (Esc)' : 'Open in fullscreen'}
        type="button"
      >
        {fullscreen ? 'Exit' : 'Fullscreen'}
      </button>
    </div>
  );

  const canvasSurface = (
    <div
      ref={containerRef}
      className={
        fullscreen
          ? 'flex-1 relative bg-[#141414] overflow-hidden cursor-grab active:cursor-grabbing'
          : 'relative w-full h-64 bg-[#141414] rounded-lg border border-gray-700 overflow-hidden cursor-grab active:cursor-grabbing'
      }
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} className="block" style={{ pointerEvents: 'none' }} />
      {!fullscreen && (
        <div className="absolute top-1 right-1 bg-[#1a1a1a]/90 backdrop-blur-sm rounded border
                        border-gray-700 px-1.5 py-1">
          {toolbar}
        </div>
      )}
      {fullscreen && (
        <div className="absolute bottom-2 left-2 text-[11px] text-gray-500 bg-[#0d0d0d]/70
                        backdrop-blur-sm rounded px-2 py-1 pointer-events-none select-none">
          Drag or scroll to pan · Shift+wheel for horizontal · Ctrl/⌘ + scroll to zoom ·
          Arrow keys pan · F to fit · Esc to exit
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[300] bg-[#0d0d0d] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-[#1a1a1a] shrink-0">
          <h2 className="text-sm font-medium text-white">
            Relationship Graph
            <span className="ml-3 text-xs text-gray-500 font-normal">
              {layout.nodes.length} characters · {layout.edges.length} relationships ·
              {mode === 'tier' ? ' layered by tier' : ' auto-layered DAG'}
            </span>
          </h2>
          {toolbar}
        </div>
        {canvasSurface}
      </div>
    );
  }

  return canvasSurface;
}
