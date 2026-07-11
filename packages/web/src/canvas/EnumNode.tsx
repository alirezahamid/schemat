import { memo } from "react";

export interface EnumNodeData {
  name: string;
  values: string[];
  dimmed?: boolean;
  [key: string]: unknown;
}

function EnumNodeComponent({ data }: { data: EnumNodeData }) {
  return (
    <div className={`enum-node${data.dimmed ? " dimmed" : ""}`}>
      <div className="enum-header">
        <span className="enum-tag">enum</span>
        {data.name}
      </div>
      <div className="enum-body">
        {data.values.map((v) => (
          <div key={v} className="enum-value">
            {v}
          </div>
        ))}
      </div>
    </div>
  );
}

export const EnumNode = memo(EnumNodeComponent);
