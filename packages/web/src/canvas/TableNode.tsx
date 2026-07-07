import type { Column } from "@alirezahamid/schemat-core";
import { Handle, Position } from "@xyflow/react";
import { memo } from "react";
import { DEFAULT_SOURCE_HANDLE, DEFAULT_TARGET_HANDLE, columnHandle } from "./graph";

export interface DisplayColumn extends Column {
  isForeignKey: boolean;
}

export interface TableNodeData {
  name: string;
  comment: string | null;
  columns: DisplayColumn[];
  /** Set while another table is hovered and this one is not related. */
  dimmed?: boolean;
  [key: string]: unknown;
}

function Badge({ text, title }: { text: string; title: string }) {
  return (
    <span className="badge" title={title}>
      {text}
    </span>
  );
}

function ColumnRow({ col }: { col: DisplayColumn }) {
  return (
    <div className="col-row">
      {/* Per-column connection points so FK edges attach to the exact row. */}
      <Handle
        type="target"
        position={Position.Left}
        id={columnHandle(col.name, "target")}
        className="handle col-handle"
      />
      <span className="col-name">
        {col.name}
        {col.nullable ? "?" : ""}
      </span>
      <span className="col-meta">
        <span className="col-type">{col.type}</span>
        {col.isPrimaryKey ? <Badge text="PK" title="Primary key" /> : null}
        {col.isForeignKey ? <Badge text="FK" title="Foreign key" /> : null}
        {col.isUnique && !col.isPrimaryKey ? <Badge text="U" title="Unique" /> : null}
      </span>
      <Handle
        type="source"
        position={Position.Right}
        id={columnHandle(col.name, "source")}
        className="handle col-handle"
      />
    </div>
  );
}

function TableNodeComponent({ data }: { data: TableNodeData }) {
  return (
    <div
      className={`table-node${data.dimmed ? " dimmed" : ""}`}
      title={data.comment ?? undefined}
    >
      {/* Node-level fallback handles for edges with no specific column (m2m). */}
      <Handle
        type="target"
        position={Position.Left}
        id={DEFAULT_TARGET_HANDLE}
        className="handle node-handle"
      />
      <Handle
        type="source"
        position={Position.Right}
        id={DEFAULT_SOURCE_HANDLE}
        className="handle node-handle"
      />
      <div className="table-header">{data.name}</div>
      <div className="table-body">
        {data.columns.map((col) => (
          <ColumnRow key={col.name} col={col} />
        ))}
      </div>
    </div>
  );
}

export const TableNode = memo(TableNodeComponent);
