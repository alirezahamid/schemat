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
import { useEffect, useMemo, useState } from "react";
import { TableNode, type TableNodeData } from "./canvas/TableNode";
import { schemaToGraph } from "./canvas/graph";
import { layoutGraph } from "./canvas/layout";
import { connectLiveUpdates, readInitialSchema } from "./ws";

const nodeTypes = { table: TableNode };

function Canvas({ schema }: { schema: IRSchema }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    let cancelled = false;
    const { nodes: rawNodes, edges: rawEdges } = schemaToGraph(schema);
    // Preserve existing positions across live reloads (match by table name).
    const pinned: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) {
      if (n.position.x !== 0 || n.position.y !== 0) pinned[n.id] = n.position;
    }
    layoutGraph(rawNodes, rawEdges, pinned).then((laidOut) => {
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

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
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
