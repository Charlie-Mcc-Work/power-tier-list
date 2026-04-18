import { useMemo, useRef, useEffect, useState } from 'react';
import dagre from '@dagrejs/dagre';
import type { Relationship, Character } from '../../types';

interface Props {
  relationships: Relationship[];
  characters: Character[];
}

interface LayoutNode {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutEdge {
  from: string;
  to: string;
  strict: boolean;
  points: Array<{ x: number; y: number }>;
}

const NODE_WIDTH = 120;
const NODE_HEIGHT = 36;

export function GraphView({ relationships, characters }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const charMap = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters],
  );

  // Only include characters that have at least one relationship
  const layout = useMemo(() => {
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
    for (const id of g.nodes()) {
      const node = g.node(id);
      if (!node) continue;
      nodes.push({
        id,
        name: (node as Record<string, unknown>).label as string ?? id,
        x: node.x,
        y: node.y,
        width: node.width ?? NODE_WIDTH,
        height: node.height ?? NODE_HEIGHT,
      });
    }

    const edges: LayoutEdge[] = [];
    for (const e of g.edges()) {
      const edgeData = g.edge(e);
      edges.push({
        from: e.v,
        to: e.w,
        strict: (edgeData as { strict?: boolean }).strict ?? false,
        points: edgeData.points ?? [],
      });
    }

    return { nodes, edges };
  }, [relationships, charMap]);

  // Center the graph on first load
  useEffect(() => {
    if (!layout || !containerRef.current) return;
    let maxX = 0, maxY = 0;
    for (const n of layout.nodes) {
      maxX = Math.max(maxX, n.x + n.width / 2);
      maxY = Math.max(maxY, n.y + n.height / 2);
    }
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const fitZoom = Math.min(cw / (maxX + 40), ch / (maxY + 40), 1);
    setZoom(fitZoom);
    setPan({ x: (cw - maxX * fitZoom) / 2, y: 10 });
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !layout) return;

    canvas.width = container.clientWidth * 2;
    canvas.height = container.clientHeight * 2;
    canvas.style.width = `${container.clientWidth}px`;
    canvas.style.height = `${container.clientHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(2, 2);
    ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw edges
    for (const edge of layout.edges) {
      ctx.beginPath();
      ctx.strokeStyle = edge.strict ? '#d97706' : '#525252';
      ctx.lineWidth = edge.strict ? 2 : 1.5;
      const pts = edge.points;
      if (pts.length > 0) {
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
      }
      ctx.stroke();

      // Arrowhead
      if (pts.length >= 2) {
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
        const size = 8;
        ctx.beginPath();
        ctx.fillStyle = edge.strict ? '#d97706' : '#525252';
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(last.x - size * Math.cos(angle - 0.4), last.y - size * Math.sin(angle - 0.4));
        ctx.lineTo(last.x - size * Math.cos(angle + 0.4), last.y - size * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fill();
      }
    }

    // Draw nodes
    for (const node of layout.nodes) {
      const x = node.x - node.width / 2;
      const y = node.y - node.height / 2;

      // Background
      ctx.fillStyle = '#1e1e1e';
      ctx.strokeStyle = '#3a3a3a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, node.width, node.height, 6);
      ctx.fill();
      ctx.stroke();

      // Text
      ctx.fillStyle = '#e5e5e5';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const displayName = node.name.length > 14 ? node.name.slice(0, 13) + '...' : node.name;
      ctx.fillText(displayName, node.x, node.y);
    }

    ctx.restore();
  }, [layout, pan, zoom]);

  // Pan handlers
  function handleMouseDown(e: React.MouseEvent) {
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging.current) return;
    setPan((p) => ({
      x: p.x + e.clientX - lastMouse.current.x,
      y: p.y + e.clientY - lastMouse.current.y,
    }));
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }

  function handleMouseUp() {
    dragging.current = false;
  }

  function handleWheel(e: React.WheelEvent) {
    e.stopPropagation();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.min(3, Math.max(0.2, z * delta)));
  }

  if (!layout || layout.nodes.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4">
        Add relationships to see the graph.
      </p>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-64 bg-[#141414] rounded-lg border border-gray-700 cursor-grab active:cursor-grabbing overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
