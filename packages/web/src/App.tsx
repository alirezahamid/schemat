import type { IRSchema } from "@alirezahamid/schemat-core";
import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type Node,
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
import { type SchematNode, schemaToGraph } from "./canvas/graph";
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
  const { setCenter, getNode } = useReactFlow();

  const pinnedRef = useRef<Positions>(readInitialLayout());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the base edges so hover recompute doesn't depend on styled state.
  const baseEdges = useRef<Edge[]>([]);

  useEffect(() => {
    let cancelled = false;
    const { nodes: rawNodes, edges: rawEdges } = schemaToGraph(schema);
    baseEdges.current = rawEdges;
    layoutGraph(rawNodes, rawEdges, pinnedRef.current).then((laidOut) => {
      if (cancelled) return;
      setNodes(laidOut);
      setEdges(rawEdges);
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
    setNodes((current) => {
      persist(current);
      return current;
    });
  }, [persist, setNodes]);

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

  // Hover highlight: emphasise the hovered table and its neighbours, dim the
  // rest. Restored on mouse-leave. Computed once per focus, and returns the
  // existing object when nothing changed to avoid re-render churn on big graphs.
  const applyFocus = useCallback(
    (focus: string | null) => {
      const related = focus === null ? null : relatedNodeIds(focus, baseEdges.current);

      setNodes((current) =>
        current.map((n): SchematNode => {
          const dimmed = related !== null && !related.has(n.id);
          const nextOpacity = dimmed ? DIM_OPACITY : 1;
          if (n.data.dimmed === dimmed && n.style?.opacity === nextOpacity) return n;
          return {
            ...n,
            data: { ...n.data, dimmed },
            style: { ...n.style, opacity: nextOpacity },
          } as SchematNode;
        }),
      );

      setEdges((current) =>
        current.map((e) => {
          const active = focus === null || e.source === focus || e.target === focus;
          const opacity = active ? 1 : DIM_OPACITY;
          const stroke = active && focus !== null ? "#38bdf8" : "#64748b";
          // Restore the ORIGINAL animated flag from base edges on leave, so a
          // non-m2m edge doesn't stay animated after being hovered.
          const base = baseEdges.current.find((b) => b.id === e.id);
          const animated =
            focus !== null && active ? true : (base?.animated ?? false);
          if (e.style?.opacity === opacity && e.style?.stroke === stroke && e.animated === animated) {
            return e;
          }
          return {
            ...e,
            style: { ...e.style, opacity, stroke },
            animated,
          };
        }),
      );
    },
    [setNodes, setEdges],
  );

  const onNodeMouseEnter = useCallback(
    (_: unknown, node: Node) => applyFocus(node.id),
    [applyFocus],
  );
  const onNodeMouseLeave = useCallback(() => applyFocus(null), [applyFocus]);

  // Search: center + zoom to the first TABLE whose name matches the query.
  // Runs when the query OR the node set changes, so a query typed before layout
  // settles (or before a live reload lands) still resolves once nodes exist.
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
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#1e293b" gap={20} />
      <Controls />
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
          <p>No schema loaded. Run <code>schemat dev</code> in a project with a Prisma schema.</p>
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
