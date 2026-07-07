import type { IRSchema } from "@alirezahamid/schemat-core";
import type { Edge, Node } from "@xyflow/react";
import type { TableNodeData } from "./TableNode";

/** Approximate node dimensions used for layout seeding. */
export const NODE_WIDTH = 240;
export const ROW_HEIGHT = 26;
export const HEADER_HEIGHT = 40;

export function nodeHeight(columnCount: number): number {
  return HEADER_HEIGHT + columnCount * ROW_HEIGHT + 8;
}

/** Map an IR schema to React Flow nodes and edges (positions filled by layout). */
export function schemaToGraph(schema: IRSchema): {
  nodes: Node<TableNodeData>[];
  edges: Edge[];
} {
  const foreignKeyColumns = new Map<string, Set<string>>();
  for (const rel of schema.relations) {
    if (rel.fromColumns.length === 0) continue;
    const set = foreignKeyColumns.get(rel.fromTable) ?? new Set<string>();
    for (const c of rel.fromColumns) set.add(c);
    foreignKeyColumns.set(rel.fromTable, set);
  }

  const nodes: Node<TableNodeData>[] = schema.tables.map((table) => {
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

  const edges: Edge[] = schema.relations.map((rel) => ({
    id: rel.name,
    source: rel.fromTable,
    target: rel.toTable,
    label: rel.cardinality === "many-to-many" ? "N:N" : rel.cardinality === "one-to-one" ? "1:1" : "1:N",
    animated: rel.cardinality === "many-to-many",
    style: { stroke: "#64748b", strokeWidth: 1.5 },
    labelStyle: { fill: "#94a3b8", fontSize: 10 },
    labelBgStyle: { fill: "#0f172a" },
  }));

  return { nodes, edges };
}
