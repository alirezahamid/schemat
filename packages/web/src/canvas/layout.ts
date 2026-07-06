import type { Edge, Node } from "@xyflow/react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { TableNodeData } from "./TableNode";
import { NODE_WIDTH, nodeHeight } from "./graph";

const elk = new ELK();

const layoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "120",
  "elk.spacing.nodeNode": "60",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
};

/**
 * Auto-layout the graph with elkjs. Returns nodes with computed positions.
 * Nodes that already carry a non-origin position (e.g. user-dragged, restored
 * from layout.json) are pinned so layout only arranges the rest.
 */
export async function layoutGraph(
  nodes: Node<TableNodeData>[],
  edges: Edge[],
  pinned: Record<string, { x: number; y: number }> = {},
): Promise<Node<TableNodeData>[]> {
  const elkNodes: ElkNode[] = nodes.map((n) => {
    const fixed = pinned[n.id];
    return {
      id: n.id,
      width: NODE_WIDTH,
      height: nodeHeight(n.data.columns.length),
      ...(fixed ? { x: fixed.x, y: fixed.y } : {}),
    };
  });

  const graph: ElkNode = {
    id: "root",
    layoutOptions,
    children: elkNodes,
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  const laidOut = await elk.layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  for (const child of laidOut.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  return nodes.map((n) => ({
    ...n,
    position: pinned[n.id] ?? positions.get(n.id) ?? n.position,
  }));
}
