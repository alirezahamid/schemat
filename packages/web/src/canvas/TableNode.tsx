import type { Column } from "@schemat/core";
import { Handle, Position } from "@xyflow/react";
import { memo } from "react";
import {
  DEFAULT_SOURCE_HANDLE_LEFT,
  DEFAULT_SOURCE_HANDLE_RIGHT,
  DEFAULT_TARGET_HANDLE_LEFT,
  DEFAULT_TARGET_HANDLE_RIGHT,
  columnHandle,
} from "./graph";

export interface DisplayColumn extends Column {
  isForeignKey: boolean;
  /** True when this column participates in a relation and needs handles. */
  hasHandles: boolean;
}

export interface TableNodeData {
  name: string;
  comment: string | null;
  columns: DisplayColumn[];
  /** Set while another table is hovered/selected and this one is not related. */
  dimmed?: boolean;
  /** Set while this table is the click-selected focus. */
  selected?: boolean;
  /** Set on the focused table AND its related tables — reveals column dots. */
  showHandles?: boolean;
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
 * A column renders connection handles only when it participates in a relation.
 * Participating columns expose a source AND target handle on BOTH sides; the
 * edge resolver picks the side facing the peer so lines attach precisely to the
 * exact column row without looping around the node.
 */
function ColumnRow({ col }: { col: DisplayColumn }) {
  return (
    <div className="col-row">
      {col.hasHandles ? (
        <>
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
        </>
      ) : null}
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
    </div>
  );
}

function TableNodeComponent({ data }: { data: TableNodeData }) {
  const cls = `table-node${data.dimmed ? " dimmed" : ""}${data.selected ? " selected" : ""}${data.showHandles ? " show-handles" : ""}`;
  return (
    <div className={cls} title={data.comment ?? undefined}>
      {/* Node-level fallback handles (both sides) for m2m edges with no FK column. */}
      <Handle
        type="target"
        position={Position.Left}
        id={DEFAULT_TARGET_HANDLE_LEFT}
        className="handle node-handle"
      />
      <Handle
        type="source"
        position={Position.Left}
        id={DEFAULT_SOURCE_HANDLE_LEFT}
        className="handle node-handle"
      />
      <Handle
        type="target"
        position={Position.Right}
        id={DEFAULT_TARGET_HANDLE_RIGHT}
        className="handle node-handle"
      />
      <Handle
        type="source"
        position={Position.Right}
        id={DEFAULT_SOURCE_HANDLE_RIGHT}
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
