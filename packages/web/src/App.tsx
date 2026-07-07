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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TableNode, type TableNodeData } from "./canvas/TableNode";
import { schemaToGraph } from "./canvas/graph";
import { layoutGraph } from "./canvas/layout";
import {
  type Positions,
  connectLiveUpdates,
  readInitialLayout,
  readInitialSchema,
  saveLayout,
} from "./ws";

const nodeTypes = { table: TableNode };

function Canvas({ schema }: { schema: IRSchema }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Authoritative set of pinned positions: seeded from the saved layout the CLI
  // injected, then updated as the user drags. Kept in a ref so live schema
  // reloads reuse the latest positions without re-triggering layout effects.
  const pinnedRef = useRef<Positions>(readInitialLayout());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const { nodes: rawNodes, edges: rawEdges } = schemaToGraph(schema);
    // Auto-layout only fills tables with no saved/dragged position; pinned
    // tables keep exactly where they were.
    layoutGraph(rawNodes, rawEdges, pinnedRef.current).then((laidOut) => {
      if (cancelled) return;
      setNodes(laidOut);
      setEdges(rawEdges);
    });
    return () => {
      cancelled = true;
    };
    // Re-run only when the schema identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  // Persist positions shortly after a drag settles (debounced), so rapid
  // dragging collapses into a single write.
  const persist = useCallback((current: Node<TableNodeData>[]) => {
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

  // Flush any pending debounced save on unmount or when the tab is hidden, so a
  // final drag right before closing/refreshing is never lost.
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

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
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
          <span className="stats">
            {schema.tables.length} tables · {schema.relations.length} relations ·{" "}
            {schema.enums.length} enums
          </span>
        </header>
        <div className="canvas-wrap">
          <Canvas schema={schema} />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
