import { describe, expect, it } from "vitest";
import type { IRSchema } from "@alirezahamid/schemat-core";
import { renderMermaid } from "../src/mermaid";
import { renderSvg } from "../src/render-node";

/** A hostile IR: names/types/labels stuffed with injection payloads. */
const evil: IRSchema = {
  version: 1,
  tables: [
    {
      name: 'User"; DROP\nerDiagram evil',
      comment: "<script>alert(1)</script>",
      columns: [
        {
          name: 'id" }\n  Evil { x y',
          type: "<img src=x onerror=alert(1)>",
          nullable: false,
          isPrimaryKey: true,
          isUnique: false,
          default: null,
          comment: null,
        },
        {
          name: "normal",
          type: "String",
          nullable: true,
          isPrimaryKey: false,
          isUnique: true,
          default: null,
          comment: null,
        },
      ],
    },
    {
      // Same sanitised token as another? force collision handling.
      name: "User x",
      comment: null,
      columns: [],
    },
  ],
  enums: [{ name: "Role</text><script>x", values: ["A&B", "<b>C</b>"] }],
  relations: [
    {
      name: 'rel" injected : "\n  X ||--|| Y',
      fromTable: 'User"; DROP\nerDiagram evil',
      fromColumns: ['id" }\n  Evil { x y'],
      toTable: "User x",
      toColumns: [],
      cardinality: "one-to-many",
    },
    // Relation to a missing table — must be dropped, not crash.
    {
      name: "ghost",
      fromTable: "DoesNotExist",
      fromColumns: ["x"],
      toTable: "User x",
      toColumns: ["y"],
      cardinality: "one-to-one",
    },
  ],
};

describe("renderMermaid — injection safety", () => {
  it("never emits a raw double-quote or newline inside identifiers/labels that could break out", () => {
    const out = renderMermaid(evil);
    // The output must still be a single erDiagram block: no injected top-level
    // "erDiagram" beyond the first line, and every line is properly indented.
    const lines = out.split("\n");
    expect(lines[0]).toBe("erDiagram");
    // No other line may reintroduce a bare "erDiagram" directive.
    expect(lines.slice(1).some((l) => l.trim() === "erDiagram evil" || l.trim().startsWith("erDiagram"))).toBe(false);
    // Entity/attribute identifier lines must be safe tokens or quoted labels only.
    // No unescaped stray double-quote should appear outside a `: "..."` label.
    for (const line of lines) {
      const labelMatch = line.match(/: "(.*)"$/);
      if (labelMatch) {
        // inside a label the raw `"` must have been escaped to #quot;
        expect(labelMatch[1].includes('"')).toBe(false);
      }
    }
    // Missing-table relation dropped.
    expect(out.includes("DoesNotExist")).toBe(false);
  });

  it("is deterministic", () => {
    expect(renderMermaid(evil)).toBe(renderMermaid(evil));
  });
});

describe("renderSvg — injection safety", () => {
  it("escapes all user text; no raw < from payloads leaks as markup", async () => {
    const svg = await renderSvg(evil);
    // The only literal '<' should belong to real SVG tags, never to payloads.
    expect(svg.includes("<script>")).toBe(false);
    expect(svg.includes("<img src=x")).toBe(false);
    expect(svg.includes("</text><script>")).toBe(false);
    // Payload angle brackets must appear escaped.
    expect(svg.includes("&lt;script&gt;") || !svg.includes("script")).toBe(true);
    // Valid, non-empty dimensions.
    expect(svg).toMatch(/width="\d+" height="\d+"/);
  });

  it("handles a missing-table relation without NaN coordinates", async () => {
    const svg = await renderSvg(evil);
    expect(svg.includes("NaN")).toBe(false);
    expect(svg.includes("undefined")).toBe(false);
  });

  it("renders an empty schema to a valid small SVG", async () => {
    const empty: IRSchema = { version: 1, tables: [], enums: [], relations: [] };
    const svg = await renderSvg(empty);
    expect(svg).toMatch(/<svg[^>]*width="\d+"/);
    expect(svg.includes("NaN")).toBe(false);
  });
});
