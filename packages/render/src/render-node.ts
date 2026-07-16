import type { IRSchema } from "@schemat/core";
import type { PinnedPositions } from "./geometry";
import { layoutSchema } from "./layout";
import { renderSvgFromPlacement } from "./svg";

export interface SvgOptions {
  /** Saved positions from `.schemat/layout.json` to honour on export. */
  pinned?: PinnedPositions;
}

/**
 * Render a schema to a self-contained, dark-themed SVG string. Computes an elk
 * layout (Node-only — pulls in the layout engine) honouring any pinned
 * positions, then serialises. Use this from the CLI. The browser exports via
 * `renderSvgFromPlacement` with live React Flow positions, avoiding elk.
 */
export async function renderSvg(schema: IRSchema, options: SvgOptions = {}): Promise<string> {
  const placement = await layoutSchema(schema, options.pinned);
  return renderSvgFromPlacement(schema, placement);
}
