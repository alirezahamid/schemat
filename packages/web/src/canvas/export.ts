import type { IRSchema } from "@alirezahamid/schemat-core";
import {
  NODE_WIDTH,
  type PlacedNode,
  type Placement,
  nodeHeight,
  renderSvgFromPlacement,
} from "@alirezahamid/schemat-render";
import type { Node } from "@xyflow/react";

/**
 * Build a render {@link Placement} from the LIVE React Flow nodes on the canvas,
 * so the exported SVG matches exactly what the user sees (including any tables
 * they've dragged). Falls back to measured dimensions when available, else the
 * canonical node geometry.
 */
function placementFromNodes(nodes: Node[]): Placement {
  const placed = new Map<string, PlacedNode>();
  let width = 0;
  let height = 0;

  for (const n of nodes) {
    const kind: "table" | "enum" = n.type === "enum" ? "enum" : "table";
    const data = n.data as { columns?: unknown[]; values?: unknown[] };
    const rows = data.columns?.length ?? data.values?.length ?? 1;
    const w = n.measured?.width ?? NODE_WIDTH;
    const h = n.measured?.height ?? nodeHeight(rows);
    const x = n.position.x;
    const y = n.position.y;
    placed.set(n.id, { id: n.id, kind, x, y, width: w, height: h, rows });
    width = Math.max(width, x + w);
    height = Math.max(height, y + h);
  }

  return { nodes: placed, width, height };
}

/** Trigger a browser download of `content` as `filename` with the given MIME. */
function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Render the current canvas to SVG (matching the on-screen arrangement) and
 * download it. Uses the shared `renderSvgFromPlacement` so browser and CLI
 * exports produce identical output.
 */
export function exportSvg(schema: IRSchema, nodes: Node[]): void {
  try {
    const placement = placementFromNodes(nodes);
    const svg = renderSvgFromPlacement(schema, placement);
    downloadFile(svg, "schema.svg", "image/svg+xml");
  } catch (err) {
    // Never let an export failure silently do nothing — surface it.
    console.error("Schemat: SVG export failed", err);
  }
}
