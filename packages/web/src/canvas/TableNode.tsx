import type { Column } from "@alirezahamid/schemat-core";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";

export interface DisplayColumn extends Column {
  isForeignKey: boolean;
}

export interface TableNodeData {
  name: string;
  comment: string | null;
  columns: DisplayColumn[];
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
      <span className="col-name">
        {col.name}
        {!col.nullable ? "" : "?"}
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

function TableNodeComponent({ data }: NodeProps) {
  const node = data as TableNodeData;
  return (
    <div className="table-node" title={node.comment ?? undefined}>
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="table-header">{node.name}</div>
      <div className="table-body">
        {node.columns.map((col) => (
          <ColumnRow key={col.name} col={col} />
        ))}
      </div>
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  );
}

export const TableNode = memo(TableNodeComponent);
