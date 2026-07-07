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
 * Handle id for a column's connection point. Each column has a source and a
 * target handle on BOTH sides; the edge resolver picks the side facing the
 * connected table so the line leaves/enters the exact column row precisely.
 */
export function columnHandle(
  column: string,
  role: "source" | "target",
  side: HandleSide,
): string {
  return `${column}::${role}::${side}`;
}

/** Node-level fallback handle ids, used by edges with no specific column (m2m). */
export const DEFAULT_SOURCE_HANDLE = "node::source";
export const DEFAULT_TARGET_HANDLE = "node::target";

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
  for (const rel of schema.relations) {
    if (rel.fromColumns.length === 0) continue;
    const set = foreignKeyColumns.get(rel.fromTable) ?? new Set<string>();
    for (const c of rel.fromColumns) set.add(c);
    foreignKeyColumns.set(rel.fromTable, set);
  }

  const tableNodes: TableFlowNode[] = schema.tables.map((table) => {
    const fks = foreignKeyColumns.get(table.name) ?? new Set<string>();
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
    // Default to right(source) -> left(target); resolveEdgeHandles fixes the
    // side once node positions are known.
    return {
      id: rel.name,
      source: rel.fromTable,
      target: rel.toTable,
      sourceHandle: fromColumn
        ? columnHandle(fromColumn, "source", "right")
        : DEFAULT_SOURCE_HANDLE,
      targetHandle: toColumn ? columnHandle(toColumn, "target", "left") : DEFAULT_TARGET_HANDLE,
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
 * edge so the FK line leaves the source column on the side facing the target
 * table, and enters the target column on the side facing the source. Returns a
 * new edge array only when a handle actually changed (referential stability).
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
    if (!cols?.fromColumn || !cols.toColumn) return e; // m2m / node-level handles

    const from = centerX.get(e.source);
    const to = centerX.get(e.target);
    if (from === undefined || to === undefined) return e;

    // Source exits toward the target; target receives from the source side.
    const sourceSide: HandleSide = to >= from ? "right" : "left";
    const targetSide: HandleSide = to >= from ? "left" : "right";

    const sourceHandle = columnHandle(cols.fromColumn, "source", sourceSide);
    const targetHandle = columnHandle(cols.toColumn, "target", targetSide);
    if (e.sourceHandle === sourceHandle && e.targetHandle === targetHandle) return e;

    changed = true;
    return { ...e, sourceHandle, targetHandle };
  });

  return changed ? next : edges;
}
