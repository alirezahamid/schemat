import type { Column, IRSchema, Relation } from "@schemat/core";
import { HEADER_HEIGHT, NODE_WIDTH, type PlacedNode, type Placement, ROW_HEIGHT } from "./geometry";

/** Theme tokens — kept aligned with the web canvas dark theme. */
const THEME = {
  bg: "#0f172a",
  grid: "#1e293b",
  nodeBg: "#0b1220",
  nodeBorder: "#1e293b",
  headerBg: "#111c33",
  headerText: "#e2e8f0",
  rowText: "#e2e8f0",
  typeText: "#64748b",
  divider: "#1e293b",
  enumBg: "#1a1330",
  enumBorder: "#4c1d95",
  enumHeader: "#2a1a4a",
  edge: "#64748b",
  edgeLabelBg: "#0f172a",
  edgeLabelText: "#94a3b8",
  pkBadge: "#f59e0b",
  fkBadge: "#a855f7",
  uniqueBadge: "#22c55e",
  badgeText: "#0b1220",
};

const PADDING = 40;
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/** Escape text for safe inclusion in SVG/XML. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Y offset (from node top) of a given row's vertical center. */
function rowCenterY(rowIndex: number): number {
  return HEADER_HEIGHT + rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function badge(x: number, y: number, text: string, fill: string): string {
  const w = 8 + text.length * 7;
  return `<g transform="translate(${x - w},${y - 8})"><rect width="${w}" height="16" rx="3" fill="${fill}"/><text x="${w / 2}" y="12" text-anchor="middle" font-family="${MONO}" font-size="10" font-weight="700" fill="${THEME.badgeText}">${esc(text)}</text></g>`;
}

function columnRow(col: Column, node: PlacedNode, index: number): string {
  const y = node.y + HEADER_HEIGHT + index * ROW_HEIGHT;
  const cy = y + ROW_HEIGHT / 2;
  const nameX = node.x + 12;
  const rightX = node.x + node.width - 10;

  const badges: string[] = [];
  let bx = rightX;
  if (col.isPrimaryKey) {
    badges.push(badge(bx, cy, "PK", THEME.pkBadge));
    bx -= 30;
  }
  if (col.isUnique && !col.isPrimaryKey) {
    badges.push(badge(bx, cy, "U", THEME.uniqueBadge));
    bx -= 22;
  }

  const label = `${col.name}${col.nullable ? "?" : ""}`;
  const divider =
    index > 0
      ? `<line x1="${node.x}" y1="${y}" x2="${node.x + node.width}" y2="${y}" stroke="${THEME.divider}" stroke-width="1"/>`
      : "";

  return `${divider}<text x="${nameX}" y="${cy + 4}" font-family="${MONO}" font-size="12" fill="${THEME.rowText}">${esc(label)}</text><text x="${bx - 8}" y="${cy + 4}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${THEME.typeText}">${esc(col.type)}</text>${badges.join("")}`;
}

function tableNode(node: PlacedNode, columns: Column[]): string {
  const rows = columns.map((c, i) => columnRow(c, node, i)).join("");
  const name = node.id;
  return `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="${THEME.nodeBg}" stroke="${THEME.nodeBorder}" stroke-width="1"/><path d="M${node.x},${node.y + HEADER_HEIGHT} v-${HEADER_HEIGHT - 8} a8,8 0 0 1 8,-8 h${node.width - 16} a8,8 0 0 1 8,8 v${HEADER_HEIGHT - 8} z" fill="${THEME.headerBg}"/><text x="${node.x + 12}" y="${node.y + 25}" font-family="${FONT}" font-size="14" font-weight="700" fill="${THEME.headerText}">${esc(name)}</text>${rows}</g>`;
}

function enumNode(node: PlacedNode, values: string[]): string {
  const name = node.id.replace(/^enum:/, "");
  const rows = values
    .map((v, i) => {
      const cy = node.y + HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2;
      const divider =
        i > 0
          ? `<line x1="${node.x}" y1="${node.y + HEADER_HEIGHT + i * ROW_HEIGHT}" x2="${node.x + node.width}" y2="${node.y + HEADER_HEIGHT + i * ROW_HEIGHT}" stroke="${THEME.enumBorder}" stroke-opacity="0.4" stroke-width="1"/>`
          : "";
      return `${divider}<text x="${node.x + 12}" y="${cy + 4}" font-family="${MONO}" font-size="12" fill="${THEME.rowText}">${esc(v)}</text>`;
    })
    .join("");
  return `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="${THEME.enumBg}" stroke="${THEME.enumBorder}" stroke-width="1"/><path d="M${node.x},${node.y + HEADER_HEIGHT} v-${HEADER_HEIGHT - 8} a8,8 0 0 1 8,-8 h${node.width - 16} a8,8 0 0 1 8,8 v${HEADER_HEIGHT - 8} z" fill="${THEME.enumHeader}"/><text x="${node.x + 12}" y="${node.y + 25}" font-family="${FONT}" font-size="13" font-weight="700" fill="${THEME.headerText}">${esc(name)} <tspan fill="${THEME.typeText}" font-size="10">enum</tspan></text>${rows}</g>`;
}

/** Anchor point for a relation end on a table, at the given column's row. */
function anchor(
  node: PlacedNode,
  columns: Column[],
  column: string | undefined,
  side: "left" | "right",
): { x: number; y: number } {
  const x = side === "right" ? node.x + node.width : node.x;
  const idx = column ? columns.findIndex((c) => c.name === column) : -1;
  // Fall back to node vertical center when the column isn't found (m2m).
  const y = idx >= 0 ? node.y + rowCenterY(idx) : node.y + node.height / 2;
  return { x, y };
}

function edgePath(
  rel: Relation,
  nodes: Map<string, PlacedNode>,
  tableColumns: Map<string, Column[]>,
): string {
  const from = nodes.get(rel.fromTable);
  const to = nodes.get(rel.toTable);
  if (!from || !to) return "";

  const fromCenter = from.x + from.width / 2;
  const toCenter = to.x + to.width / 2;
  const fromSide = toCenter >= fromCenter ? "right" : "left";
  const toSide = toCenter >= fromCenter ? "left" : "right";

  const a = anchor(from, tableColumns.get(rel.fromTable) ?? [], rel.fromColumns[0], fromSide);
  const b = anchor(to, tableColumns.get(rel.toTable) ?? [], rel.toColumns[0], toSide);

  // Smooth cubic bezier with horizontal control handles (matches React Flow).
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  const c1x = fromSide === "right" ? a.x + dx : a.x - dx;
  const c2x = toSide === "left" ? b.x - dx : b.x + dx;
  const d = `M${a.x},${a.y} C${c1x},${a.y} ${c2x},${b.y} ${b.x},${b.y}`;

  const label =
    rel.cardinality === "many-to-many" ? "N:N" : rel.cardinality === "one-to-one" ? "1:1" : "1:N";
  const dashed = rel.cardinality === "many-to-many";
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const lw = 8 + label.length * 7;

  return `<path d="${d}" fill="none" stroke="${THEME.edge}" stroke-width="1.5"${dashed ? ' stroke-dasharray="5 4"' : ""}/><g transform="translate(${mx - lw / 2},${my - 9})"><rect width="${lw}" height="18" rx="3" fill="${THEME.edgeLabelBg}" stroke="${THEME.nodeBorder}"/><text x="${lw / 2}" y="13" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${THEME.edgeLabelText}">${esc(label)}</text></g>`;
}

/**
 * Render a schema to SVG from an already-computed {@link Placement}. Pure and
 * browser-safe (no elk / layout dependency) — the web canvas passes the live
 * React Flow node positions here so the export matches exactly what's on screen.
 * The CLI computes a Placement with elk first (see renderSvg in render-node).
 */
export function renderSvgFromPlacement(schema: IRSchema, placement: Placement): string {
  // Work on a shallow copy of the placed nodes so we never mutate the caller's
  // positions while normalising coordinates.
  const nodes = new Map<string, PlacedNode>();
  for (const [id, n] of placement.nodes) nodes.set(id, { ...n });

  // Normalise coordinates so the content starts at PADDING (elk may emit
  // negative or offset origins, and pinned/live layouts can start anywhere).
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const n of nodes.values()) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
  }
  const shiftX = PADDING - minX;
  const shiftY = PADDING - minY;

  let maxX = 0;
  let maxY = 0;
  for (const n of nodes.values()) {
    n.x += shiftX;
    n.y += shiftY;
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }

  const width = maxX + PADDING;
  const height = maxY + PADDING;

  const tableColumns = new Map<string, Column[]>();
  for (const t of schema.tables) tableColumns.set(t.name, t.columns);

  // Edges first (under nodes), then nodes on top.
  const edges = schema.relations.map((r) => edgePath(r, nodes, tableColumns)).join("");

  const bodies: string[] = [];
  for (const t of schema.tables) {
    const node = nodes.get(t.name);
    if (node) bodies.push(tableNode(node, t.columns));
  }
  for (const e of schema.enums) {
    const node = nodes.get(`enum:${e.name}`);
    if (node) bodies.push(enumNode(node, e.values));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}"><rect width="${width}" height="${height}" fill="${THEME.bg}"/><defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${THEME.grid}"/></pattern></defs><rect width="${width}" height="${height}" fill="url(#grid)"/>${edges}${bodies.join("")}</svg>\n`;
}
