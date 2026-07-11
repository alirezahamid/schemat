import type { Edge } from "@xyflow/react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { NODE_WIDTH, type SchematNode, nodeHeight } from "./graph";

const elk = new ELK();

const layoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "120",
  "elk.spacing.nodeNode": "60",
  // Interactive placement honours the seeded x/y of pinned nodes, so new
  // (unpinned) tables are arranged around them instead of on top of them.
  "elk.layered.nodePlacement.strategy": "INTERACTIVE",
  "elk.layered.crossingMinimization.strategy": "INTERACTIVE",
  "elk.interactive": "true",
};

/** Row count used to estimate a node's height (columns for tables, values for enums). */
function rowCount(node: SchematNode): number {
  const data = node.data as { columns?: unknown[]; values?: unknown[] };
  return data.columns?.length ?? data.values?.length ?? 1;
}

/**
 * Auto-layout the graph with elkjs. Nodes present in `pinned` (restored from
 * layout.json or user-dragged) keep their exact positions; only unpinned nodes
 * are placed by the algorithm, arranged around the pinned ones.
 */
export async function layoutGraph(
  nodes: SchematNode[],
  edges: Edge[],
  pinned: Record<string, { x: number; y: number }> = {},
): Promise<SchematNode[]> {
  const elkNodes: ElkNode[] = nodes.map((n) => {
    const fixed = pinned[n.id];
    return {
      id: n.id,
      width: NODE_WIDTH,
      height: nodeHeight(rowCount(n)),
      ...(fixed
        ? // Seed position AND mark the node fixed so ELK won't move it.
          { x: fixed.x, y: fixed.y, layoutOptions: { "elk.fixed": "true" } }
        : {}),
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
    // Pinned nodes always keep their exact saved position; the ELK result is
    // only used for nodes that had none.
    position: pinned[n.id] ?? positions.get(n.id) ?? n.position,
  }));
}
