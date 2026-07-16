import type { IRSchema } from "@schemat/core";
import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EnumNode } from "./canvas/EnumNode";
import { TableNode } from "./canvas/TableNode";
import { exportSvg } from "./canvas/export";
import { type SchematNode, resolveEdgeHandles, schemaToGraph } from "./canvas/graph";
import { layoutGraph } from "./canvas/layout";
import {
  type Positions,
  connectLiveUpdates,
  readInitialLayout,
  readInitialSchema,
  saveLayout,
} from "./ws";

const nodeTypes = { table: TableNode, enum: EnumNode };

const DIM_OPACITY = 0.18;

/** Build the set of node ids directly connected to `focus` (plus focus itself). */
function relatedNodeIds(focus: string, edges: Edge[]): Set<string> {
  const related = new Set<string>([focus]);
  for (const e of edges) {
    if (e.source === focus) related.add(e.target);
    if (e.target === focus) related.add(e.source);
  }
  return related;
}

function Canvas({ schema, query }: { schema: IRSchema; query: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<SchematNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { setCenter, getNode, getNodes } = useReactFlow();

  const pinnedRef = useRef<Positions>(readInitialLayout());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the base edges so hover recompute doesn't depend on styled state.
  const baseEdges = useRef<Edge[]>([]);
  // O(1) lookup of each edge's original animated flag (m2m edges animate).
  const baseAnimated = useRef<Map<string, boolean>>(new Map());
  // The click-selected table (sticky). Hover only takes effect when nothing is
  // selected; a selection overrides hover until the user clicks away.
  const selectedRef = useRef<string | null>(null);

  // Recompute which side each edge attaches to, based on current node x-order.
  // Reads nodes via getNodes() so we never call setEdges inside a setNodes
  // updater (which must stay pure, esp. under StrictMode).
  const relayoutEdges = useCallback(() => {
    const current = getNodes() as SchematNode[];
    setEdges((currentEdges) => resolveEdgeHandles(currentEdges, current));
  }, [getNodes, setEdges]);

  // This effect intentionally re-runs only when `schema` changes (live reload).
  // The setState/getNodes helpers are stable and excluded on purpose.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on schema by design
  useEffect(() => {
    let cancelled = false;
    const { nodes: rawNodes, edges: rawEdges } = schemaToGraph(schema);
    baseEdges.current = rawEdges;
    baseAnimated.current = new Map(rawEdges.map((e) => [e.id, e.animated ?? false]));
    // If the sticky-selected table no longer exists after a live reload, drop
    // the selection so hover isn't silently blocked.
    if (selectedRef.current && !rawNodes.some((n) => n.id === selectedRef.current)) {
      selectedRef.current = null;
    }
    layoutGraph(rawNodes, rawEdges, pinnedRef.current).then((laidOut) => {
      if (cancelled) return;
      setNodes(laidOut);
      // Resolve handle sides now that positions are known.
      setEdges(resolveEdgeHandles(rawEdges, laidOut));
      // Reapply the sticky selection's highlight to the freshly laid-out graph.
      if (selectedRef.current) applyFocusRef.current?.(selectedRef.current);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  const persist = useCallback((current: SchematNode[]) => {
    const positions: Positions = {};
    for (const n of current) positions[n.id] = { x: n.position.x, y: n.position.y };
    pinnedRef.current = positions;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveLayout(positions);
    }, 400);
  }, []);

  const onNodeDragStop = useCallback(() => {
    persist(getNodes() as SchematNode[]);
    // A moved node may now sit on the other side of its neighbour.
    relayoutEdges();
  }, [persist, getNodes, relayoutEdges]);

  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void saveLayout(pinnedRef.current);
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  // Highlight the focused table and its neighbours; dim the rest. `selected`
  // marks the sticky click target so it can get a distinct outline. Computed
  // once per focus; unchanged nodes/edges are returned as-is (perf).
  const applyFocus = useCallback(
    (focus: string | null) => {
      const related = focus === null ? null : relatedNodeIds(focus, baseEdges.current);
      const selected = selectedRef.current;

      setNodes((current) =>
        current.map((n): SchematNode => {
          const dimmed = related !== null && !related.has(n.id);
          const isSelected = n.id === selected;
          // Show column dots on the focused table AND every table it relates to,
          // so both ends of each relation reveal their connection points.
          const showHandles = related?.has(n.id);
          const nextOpacity = dimmed ? DIM_OPACITY : 1;
          if (
            n.data.dimmed === dimmed &&
            n.data.selected === isSelected &&
            n.data.showHandles === showHandles &&
            n.style?.opacity === nextOpacity
          ) {
            return n;
          }
          return {
            ...n,
            data: { ...n.data, dimmed, selected: isSelected, showHandles },
            style: { ...n.style, opacity: nextOpacity },
          } as SchematNode;
        }),
      );

      setEdges((current) =>
        current.map((e) => {
          const active = focus === null || e.source === focus || e.target === focus;
          const opacity = active ? 1 : DIM_OPACITY;
          const stroke = active && focus !== null ? "#38bdf8" : "#64748b";
          const wasAnimated = baseAnimated.current.get(e.id) ?? false;
          const animated = focus !== null && active ? true : wasAnimated;
          if (
            e.style?.opacity === opacity &&
            e.style?.stroke === stroke &&
            e.animated === animated
          ) {
            return e;
          }
          return { ...e, style: { ...e.style, opacity, stroke }, animated };
        }),
      );
    },
    [setNodes, setEdges],
  );

  // Ref mirror of applyFocus so the schema effect (declared earlier) can call
  // the latest version without listing it as a dependency.
  const applyFocusRef = useRef(applyFocus);
  applyFocusRef.current = applyFocus;

  // Hover: transient preview, but only when no sticky selection is active.
  const onNodeMouseEnter = useCallback(
    (_: unknown, node: Node) => {
      if (selectedRef.current === null) applyFocus(node.id);
    },
    [applyFocus],
  );
  const onNodeMouseLeave = useCallback(() => {
    // Restore to the sticky selection (or clear if none).
    if (selectedRef.current === null) applyFocus(null);
    else applyFocus(selectedRef.current);
  }, [applyFocus]);

  // Click a node: make it the sticky focus (or switch to it).
  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      selectedRef.current = node.id;
      applyFocus(node.id);
    },
    [applyFocus],
  );

  // Click empty canvas: clear the sticky selection and restore full view.
  const onPaneClick = useCallback(() => {
    selectedRef.current = null;
    applyFocus(null);
  }, [applyFocus]);

  // Export the current canvas (live positions) to a downloaded SVG.
  const onExport = useCallback(() => {
    exportSvg(schema, getNodes());
  }, [schema, getNodes]);

  // Search: center + zoom to the first TABLE whose name matches the query.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const match = nodes.find((n) => n.type === "table" && n.id.toLowerCase().includes(q));
    if (!match) return;
    const rfNode = getNode(match.id);
    if (!rfNode) return;
    const w = rfNode.measured?.width ?? 240;
    const h = rfNode.measured?.height ?? 120;
    setCenter(rfNode.position.x + w / 2, rfNode.position.y + h / 2, {
      zoom: 1.2,
      duration: 400,
    });
  }, [query, nodes, getNode, setCenter]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeMouseLeave={onNodeMouseLeave}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#1e293b" gap={20} />
      <Controls />
      <Panel position="top-right">
        <button
          type="button"
          className="export-btn"
          onClick={onExport}
          title="Download the diagram as SVG"
        >
          ↓ Export SVG
        </button>
      </Panel>
      <MiniMap
        pannable
        zoomable
        nodeColor="#334155"
        maskColor="rgba(2,6,23,0.7)"
        style={{ background: "#0f172a" }}
      />
    </ReactFlow>
  );
}

export default function App() {
  const initial = useMemo(() => readInitialSchema(), []);
  const [schema, setSchema] = useState<IRSchema | null>(initial);
  const [query, setQuery] = useState("");

  useEffect(() => connectLiveUpdates(setSchema), []);

  if (!schema) {
    return (
      <div className="empty-state">
        <div>
          <h1>Schemat</h1>
          <p>
            No schema loaded. Run <code>schemat dev</code> in a project with a Prisma schema.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="app">
        <header className="topbar">
          <span className="logo">Schemat</span>
          <input
            className="search"
            type="search"
            placeholder="Find a table…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="stats">
            {schema.tables.length} tables · {schema.relations.length} relations ·{" "}
            {schema.enums.length} enums
          </span>
        </header>
        <div className="canvas-wrap">
          <Canvas schema={schema} query={query} />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
