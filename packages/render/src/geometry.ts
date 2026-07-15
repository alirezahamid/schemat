/**
 * Node geometry + placement types shared by the layout engine and the SVG
 * serialiser. This module has NO elk / heavy dependencies, so importing it (and
 * the SVG serialiser) into the browser bundle does not pull in the layout
 * engine. Kept in sync with the web canvas (packages/web/src/canvas).
 */

export const NODE_WIDTH = 240;
export const ROW_HEIGHT = 26;
export const HEADER_HEIGHT = 40;
/** Vertical padding below the last row. */
export const BODY_PADDING = 8;

export function nodeHeight(rowCount: number): number {
  return HEADER_HEIGHT + rowCount * ROW_HEIGHT + BODY_PADDING;
}

/** A positioned box for a table or enum in the exported diagram. */
export interface PlacedNode {
  id: string;
  kind: "table" | "enum";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Row count (columns for tables, values for enums). */
  rows: number;
}

export interface Placement {
  nodes: Map<string, PlacedNode>;
  width: number;
  height: number;
}

/** A saved position from `.schemat/layout.json`. */
export type PinnedPositions = Record<string, { x: number; y: number }>;
