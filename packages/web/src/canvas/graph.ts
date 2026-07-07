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

/** A React Flow node that is either a table or an enum. */
export type SchematNode = Node<TableNodeData> | Node<EnumNodeData>;

/** Handle id for a column's connection point. Kept stable for edge wiring. */
export function columnHandle(column: string, side: "source" | "target"): string {
  return `${column}::${side}`;
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

  const tableNodes: Node<TableNodeData>[] = schema.tables.map((table) => {
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

  const enumNodes: Node<EnumNodeData>[] = schema.enums.map((e) => ({
    id: `enum:${e.name}`,
    type: "enum",
    position: { x: 0, y: 0 },
    data: { name: e.name, values: e.values },
  }));

  const edges: Edge[] = schema.relations.map((rel) => {
    // Wire column-to-column when we know the exact columns; fall back to the
    // node body for implicit many-to-many (which has no scalar FK).
    const fromCol = rel.fromColumns[0];
    const toCol = rel.toColumns[0];
    return {
      id: rel.name,
      source: rel.fromTable,
      target: rel.toTable,
      sourceHandle: fromCol ? columnHandle(fromCol, "source") : undefined,
      targetHandle: toCol ? columnHandle(toCol, "target") : undefined,
      label:
        rel.cardinality === "many-to-many"
          ? "N:N"
          : rel.cardinality === "one-to-one"
            ? "1:1"
            : "1:N",
      animated: rel.cardinality === "many-to-many",
      // Store endpoints so hover highlighting can reason about connectivity.
      data: { fromTable: rel.fromTable, toTable: rel.toTable },
      style: { stroke: "#64748b", strokeWidth: 1.5 },
      labelStyle: { fill: "#94a3b8", fontSize: 10 },
      labelBgStyle: { fill: "#0f172a" },
    };
  });

  return { nodes: [...tableNodes, ...enumNodes], edges };
}
