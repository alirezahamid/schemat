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
  /** Set while another table is hovered/selected and this one is not related. */
  dimmed?: boolean;
  /** Set while this table is the click-selected focus. */
  selected?: boolean;
  [key: string]: unknown;
}

function Badge({ text, title }: { text: string; title: string }) {
  return (
    <span className="badge" title={title}>
      {text}
    </span>
  );
}

/**
 * Each column exposes a source AND a target handle on BOTH sides. The edge
 * builder picks the handle on the side facing the connected table, so an FK
 * line leaves the exact column row on the correct side and lands on the exact
 * referenced column row — precise, no looping around the node.
 */
function ColumnRow({ col }: { col: DisplayColumn }) {
  return (
    <div className="col-row">
      <Handle
        type="target"
        position={Position.Left}
        id={columnHandle(col.name, "target", "left")}
        className="handle col-handle"
      />
      <Handle
        type="source"
        position={Position.Left}
        id={columnHandle(col.name, "source", "left")}
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
        type="target"
        position={Position.Right}
        id={columnHandle(col.name, "target", "right")}
        className="handle col-handle"
      />
      <Handle
        type="source"
        position={Position.Right}
        id={columnHandle(col.name, "source", "right")}
        className="handle col-handle"
      />
    </div>
  );
}

function TableNodeComponent({ data }: { data: TableNodeData }) {
  const cls = `table-node${data.dimmed ? " dimmed" : ""}${data.selected ? " selected" : ""}`;
  return (
    <div className={cls} title={data.comment ?? undefined}>
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
