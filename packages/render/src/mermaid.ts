import type { IRSchema } from "@alirezahamid/schemat-core";

/**
 * Mermaid identifiers must match [A-Za-z0-9_]. Sanitise names that contain
 * other characters so the diagram still parses; keep a comment with the original.
 */
function safeName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name}"`;
}

/** Map an IR relation to Mermaid ER crow's-foot syntax with the FK label. */
function relationLine(
  fromTable: string,
  toTable: string,
  cardinality: string,
  label: string,
): string {
  // Mermaid ER cardinality notation:
  //   one-to-one    : ||--||
  //   one-to-many   : ||--o{
  //   many-to-many  : }o--o{
  const rel =
    cardinality === "one-to-one"
      ? "||--||"
      : cardinality === "many-to-many"
        ? "}o--o{"
        : "||--o{";
  return `  ${safeName(toTable)} ${rel} ${safeName(fromTable)} : "${label}"`;
}

/**
 * Render a schema to a Mermaid `erDiagram` block. Mermaid self-lays-out, so no
 * geometry is needed — this is a pure text transform, ideal for READMEs and
 * docs that already render Mermaid (GitHub, GitLab, many static-site tools).
 */
export function renderMermaid(schema: IRSchema): string {
  const lines: string[] = ["erDiagram"];

  for (const table of schema.tables) {
    lines.push(`  ${safeName(table.name)} {`);
    for (const col of table.columns) {
      const attrs: string[] = [];
      if (col.isPrimaryKey) attrs.push("PK");
      if (col.isUnique && !col.isPrimaryKey) attrs.push("UK");
      // Mermaid type/name are bare tokens; sanitise the type for safety.
      const type = col.type.replace(/[^A-Za-z0-9_]/g, "_") || "unknown";
      const suffix = attrs.length ? ` ${attrs.join(",")}` : "";
      lines.push(`    ${type} ${col.name}${suffix}`);
    }
    lines.push("  }");
  }

  for (const rel of schema.relations) {
    const label =
      rel.fromColumns.length > 0 ? rel.fromColumns.join(",") : rel.name;
    lines.push(relationLine(rel.fromTable, rel.toTable, rel.cardinality, label));
  }

  return `${lines.join("\n")}\n`;
}
