// Browser-safe entry: no elk / layout engine. Import this from the web canvas.
export { renderSvgFromPlacement } from "./svg";
export { renderMermaid } from "./mermaid";
export {
  NODE_WIDTH,
  ROW_HEIGHT,
  HEADER_HEIGHT,
  nodeHeight,
} from "./geometry";
export type { Placement, PlacedNode, PinnedPositions } from "./geometry";
