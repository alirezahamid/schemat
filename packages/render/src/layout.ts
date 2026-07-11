import type { IRSchema } from "@alirezahamid/schemat-core";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

/**
 * Node geometry. Kept in sync with the web canvas (packages/web/src/canvas)
 * so exported diagrams match what `schemat dev` shows on screen.
 */
export const NODE_WIDTH = 240;
export const ROW_HEIGHT = 26;
export const HEADER_HEIGHT = 40;
/** Vertical padding below the last row. */
export const BODY_PADDING = 8;

export function nodeHeight(rowCount: number): number {
  return HEADER_HEIGHT + rowCount * ROW_HEIGHT + BODY_PADDING;
}

/** A positioned box for a table or enum in the exported diagram. */
export interface PlacedNode {
  id: string;
  kind: "table" | "enum";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Row labels in order (columns for tables, values for enums). */
  rows: number;
}

export interface Placement {
  nodes: Map<string, PlacedNode>;
  width: number;
  height: number;
}

/** A saved position from `.schemat/layout.json`. */
export type PinnedPositions = Record<string, { x: number; y: number }>;

const elk = new ELK();

const layoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "120",
  "elk.spacing.nodeNode": "60",
  "elk.layered.nodePlacement.strategy": "INTERACTIVE",
  "elk.layered.crossingMinimization.strategy": "INTERACTIVE",
  "elk.interactive": "true",
};

interface RawNode {
  id: string;
  kind: "table" | "enum";
  rows: number;
}

function collectNodes(schema: IRSchema): RawNode[] {
  const tables: RawNode[] = schema.tables.map((t) => ({
    id: t.name,
    kind: "table",
    rows: t.columns.length,
  }));
  const enums: RawNode[] = schema.enums.map((e) => ({
    id: `enum:${e.name}`,
    kind: "enum",
    rows: e.values.length,
  }));
  return [...tables, ...enums];
}

/**
 * Lay out a schema for static export. Nodes present in `pinned` keep their
 * saved positions (so the export matches the user's arrangement in `dev`);
 * unpinned nodes are placed by elk, arranged around the pinned ones.
 */
export async function layoutSchema(
  schema: IRSchema,
  pinned: PinnedPositions = {},
): Promise<Placement> {
  const raw = collectNodes(schema);
  const nodeIds = new Set(raw.map((n) => n.id));

  const elkNodes: ElkNode[] = raw.map((n) => {
    const fixed = pinned[n.id];
    return {
      id: n.id,
      width: NODE_WIDTH,
      height: nodeHeight(n.rows),
      ...(fixed
        ? { x: fixed.x, y: fixed.y, layoutOptions: { "elk.fixed": "true" } }
        : {}),
    };
  });

  const graph: ElkNode = {
    id: "root",
    layoutOptions,
    children: elkNodes,
    // Only feed elk edges whose endpoints are real nodes — a relation that
    // references a missing table would otherwise destabilise the layout.
    edges: schema.relations
      .filter((r) => nodeIds.has(r.fromTable) && nodeIds.has(r.toTable))
      .map((r) => ({
        id: r.name,
        sources: [r.fromTable],
        targets: [r.toTable],
      })),
  };

  const laidOut = await elk.layout(graph);
  const byId = new Map<string, ElkNode>();
  for (const c of laidOut.children ?? []) byId.set(c.id, c);

  const nodes = new Map<string, PlacedNode>();
  let maxX = 0;
  let maxY = 0;
  for (const n of raw) {
    const elkNode = byId.get(n.id);
    const fixed = pinned[n.id];
    const x = fixed?.x ?? elkNode?.x ?? 0;
    const y = fixed?.y ?? elkNode?.y ?? 0;
    const width = NODE_WIDTH;
    const height = nodeHeight(n.rows);
    nodes.set(n.id, { id: n.id, kind: n.kind, x, y, width, height, rows: n.rows });
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  return { nodes, width: maxX, height: maxY };
}
