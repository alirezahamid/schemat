import type { IRSchema } from "@alirezahamid/schemat-core";
import type { Edge, Node } from "@xyflow/react";
import type { EnumNodeData } from "./EnumNode";
import type { TableNodeData } from "./TableNode";

/** Approximate node dimensions used for layout seeding. */
export const NODE_WIDTH = 240;
export const ROW_HEIGHT = 26;
export const HEADER_HEIGHT = 40;

export function nodeHeight(rowCount: number): number {
  return HEADER_HEIGHT + rowCount * ROW_HEIGHT + 8;
}

/** Discriminated React Flow node types. */
export type TableFlowNode = Node<TableNodeData, "table">;
export type EnumFlowNode = Node<EnumNodeData, "enum">;
export type SchematNode = TableFlowNode | EnumFlowNode;

export type HandleSide = "left" | "right";

/**
 * Handle id for a column's connection point. Only columns that participate in a
 * relation render handles; each such column exposes a source and a target
 * handle on BOTH sides, and the edge resolver picks the side facing the peer.
 */
export function columnHandle(
  column: string,
  role: "source" | "target",
  side: HandleSide,
): string {
  return `${column}::${role}::${side}`;
}

/** Node-level fallback handle ids (both sides) for edges with no scalar FK (m2m). */
export const DEFAULT_SOURCE_HANDLE_LEFT = "node::source::left";
export const DEFAULT_SOURCE_HANDLE_RIGHT = "node::source::right";
export const DEFAULT_TARGET_HANDLE_LEFT = "node::target::left";
export const DEFAULT_TARGET_HANDLE_RIGHT = "node::target::right";

/** Endpoint columns carried on an edge so we can resolve handle sides later. */
export interface EdgeColumns {
  fromTable: string;
  toTable: string;
  fromColumn?: string;
  toColumn?: string;
}

/** Map an IR schema to React Flow nodes and edges (positions filled by layout). */
export function schemaToGraph(schema: IRSchema): {
  nodes: SchematNode[];
  edges: Edge[];
} {
  const foreignKeyColumns = new Map<string, Set<string>>();
  // Columns that take part in ANY relation (either end) — only these need
  // rendered handles, keeping the DOM light on wide schemas.
  const relationColumns = new Map<string, Set<string>>();
  const addRelationCol = (table: string, col: string) => {
    const set = relationColumns.get(table) ?? new Set<string>();
    set.add(col);
    relationColumns.set(table, set);
  };

  for (const rel of schema.relations) {
    for (const c of rel.fromColumns) {
      const set = foreignKeyColumns.get(rel.fromTable) ?? new Set<string>();
      set.add(c);
      foreignKeyColumns.set(rel.fromTable, set);
      addRelationCol(rel.fromTable, c);
    }
    for (const c of rel.toColumns) addRelationCol(rel.toTable, c);
  }

  const tableNodes: TableFlowNode[] = schema.tables.map((table) => {
    const fks = foreignKeyColumns.get(table.name) ?? new Set<string>();
    const rels = relationColumns.get(table.name) ?? new Set<string>();
    return {
      id: table.name,
      type: "table",
      position: { x: 0, y: 0 },
      data: {
        name: table.name,
        comment: table.comment,
        columns: table.columns.map((col) => ({
          ...col,
          isForeignKey: fks.has(col.name),
          // Only render handles for columns that actually connect to something.
          hasHandles: rels.has(col.name),
        })),
      },
    };
  });

  const enumNodes: EnumFlowNode[] = schema.enums.map((e) => ({
    id: `enum:${e.name}`,
    type: "enum",
    position: { x: 0, y: 0 },
    data: { name: e.name, values: e.values },
  }));

  const edges: Edge[] = schema.relations.map((rel) => {
    const fromColumn = rel.fromColumns[0];
    const toColumn = rel.toColumns[0];
    return {
      id: rel.name,
      source: rel.fromTable,
      target: rel.toTable,
      sourceHandle: fromColumn
        ? columnHandle(fromColumn, "source", "right")
        : DEFAULT_SOURCE_HANDLE_RIGHT,
      targetHandle: toColumn
        ? columnHandle(toColumn, "target", "left")
        : DEFAULT_TARGET_HANDLE_LEFT,
      label:
        rel.cardinality === "many-to-many"
          ? "N:N"
          : rel.cardinality === "one-to-one"
            ? "1:1"
            : "1:N",
      animated: rel.cardinality === "many-to-many",
      data: { fromTable: rel.fromTable, toTable: rel.toTable, fromColumn, toColumn },
      style: { stroke: "#64748b", strokeWidth: 1.5 },
      labelStyle: { fill: "#94a3b8", fontSize: 10 },
      labelBgStyle: { fill: "#0f172a" },
    };
  });

  return { nodes: [...tableNodes, ...enumNodes], edges };
}

/**
 * Given current node positions, choose the handle side (left/right) for each
 * edge so the FK line leaves the source on the side facing the target and
 * enters the target on the side facing the source. Handles both column-level
 * and node-level (m2m) edges. Returns a new array only when something changed.
 */
export function resolveEdgeHandles(edges: Edge[], nodes: SchematNode[]): Edge[] {
  const centerX = new Map<string, number>();
  for (const n of nodes) {
    const w = n.measured?.width ?? NODE_WIDTH;
    centerX.set(n.id, n.position.x + w / 2);
  }

  let changed = false;
  const next = edges.map((e) => {
    const cols = e.data as unknown as EdgeColumns | undefined;
    if (!cols) return e;

    const from = centerX.get(e.source);
    const to = centerX.get(e.target);
    if (from === undefined || to === undefined) return e;

    const sourceSide: HandleSide = to >= from ? "right" : "left";
    const targetSide: HandleSide = to >= from ? "left" : "right";

    const sourceHandle = cols.fromColumn
      ? columnHandle(cols.fromColumn, "source", sourceSide)
      : sourceSide === "right"
        ? DEFAULT_SOURCE_HANDLE_RIGHT
        : DEFAULT_SOURCE_HANDLE_LEFT;
    const targetHandle = cols.toColumn
      ? columnHandle(cols.toColumn, "target", targetSide)
      : targetSide === "left"
        ? DEFAULT_TARGET_HANDLE_LEFT
        : DEFAULT_TARGET_HANDLE_RIGHT;

    if (e.sourceHandle === sourceHandle && e.targetHandle === targetHandle) return e;

    changed = true;
    return { ...e, sourceHandle, targetHandle };
  });

  return changed ? next : edges;
}
