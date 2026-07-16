# @schemat/render

Renderers for [Schemat](https://github.com/alirezahamid/schemat): produce a
headless **SVG** or **Mermaid** ER diagram from the canonical IR, plus text /
markdown rendering of schema diffs. No browser, no React.

## Install

```bash
npm i @schemat/render
```

## Usage

```ts
// Node entry (recommended): async SVG with layout, Mermaid, and diff renderers.
import {
  renderSvg,
  renderMermaid,
  renderDiffText,
  renderDiffMarkdown,
} from "@schemat/render/node";

const svg = await renderSvg(ir);          // headless SVG (elkjs layout)
const mmd = renderMermaid(ir);            // Mermaid erDiagram string
const text = renderDiffText(changes);     // human-readable diff
const md = renderDiffMarkdown(changes);   // markdown diff (for PR comments)

// Browser-safe entry: Mermaid + SVG-from-precomputed-placement (no elkjs/Node).
import { renderMermaid as m, renderSvgFromPlacement } from "@schemat/render";
```

Consumes an `IRSchema` / `SchemaChange[]` from
[`@schemat/core`](https://www.npmjs.com/package/@schemat/core).

## License

MIT © Ali Reza Hamid
