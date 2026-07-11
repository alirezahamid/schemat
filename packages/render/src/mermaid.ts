import type { IRSchema } from "@alirezahamid/schemat-core";

/**
 * Mermaid ER identifiers (entity + attribute names) must be bare tokens matching
 * roughly [A-Za-z0-9_]. Anything else can break the `erDiagram` block or inject
 * syntax, so we sanitise to a safe token. Sanitisation is deterministic (same
 * input → same output) to keep committed diagrams stable in git.
 *
 * Collisions after sanitising (e.g. "a b" and "a-b" both → "a_b") are made
 * unique with a numeric suffix via the provided registry, so two distinct
 * tables never merge into one entity.
 */
function makeSanitiser(): (raw: string) => string {
  const used = new Map<string, string>(); // raw -> emitted
  const taken = new Set<string>(); // emitted tokens

  return (raw: string): string => {
    const cached = used.get(raw);
    if (cached) return cached;

    let base = raw.replace(/[^A-Za-z0-9_]/g, "_");
    if (base === "" || /^[0-9]/.test(base)) base = `_${base}`;

    let token = base;
    let i = 2;
    while (taken.has(token)) {
      token = `${base}_${i}`;
      i += 1;
    }
    taken.add(token);
    used.set(raw, token);
    return token;
  };
}

/**
 * Escape a Mermaid quoted-string label. Mermaid uses `#...;` HTML-style entities
 * for special characters inside quotes; newlines and quotes must not appear raw
 * or they terminate the string / inject lines.
 */
function escLabel(text: string): string {
  return text
    .replace(/#/g, "#35;")
    .replace(/"/g, "#quot;")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/** Map a cardinality to Mermaid ER crow's-foot notation. */
function relSymbol(cardinality: string): string {
  // one-to-one ||--||, one-to-many ||--o{, many-to-many }o--o{
  if (cardinality === "one-to-one") return "||--||";
  if (cardinality === "many-to-many") return "}o--o{";
  return "||--o{";
}

/**
 * Render a schema to a Mermaid `erDiagram` block. Mermaid self-lays-out, so no
 * geometry is needed — a pure, deterministic text transform ideal for READMEs
 * and docs that render Mermaid (GitHub, GitLab, many static-site tools).
 *
 * All entity/attribute identifiers are sanitised to safe tokens and all label
 * text is escaped, so no schema name/type/comment can inject Mermaid syntax.
 */
export function renderMermaid(schema: IRSchema): string {
  const sanitise = makeSanitiser();
  // Pre-register every entity name so relation lines reference the same token.
  const tableToken = new Map<string, string>();
  for (const table of schema.tables) tableToken.set(table.name, sanitise(table.name));

  const lines: string[] = ["erDiagram"];

  for (const table of schema.tables) {
    const token = tableToken.get(table.name) ?? sanitise(table.name);
    lines.push(`  ${token} {`);
    // Per-table column-name sanitiser (column tokens only need to be unique
    // within their table, and Mermaid scopes attributes per entity).
    const sanitiseCol = makeSanitiser();
    for (const col of table.columns) {
      const attrs: string[] = [];
      if (col.isPrimaryKey) attrs.push("PK");
      if (col.isUnique && !col.isPrimaryKey) attrs.push("UK");
      const type = col.type.replace(/[^A-Za-z0-9_]/g, "_") || "unknown";
      const name = sanitiseCol(col.name);
      const suffix = attrs.length ? ` ${attrs.join(",")}` : "";
      lines.push(`    ${type} ${name}${suffix}`);
    }
    lines.push("  }");
  }

  for (const rel of schema.relations) {
    // Only emit relations whose endpoints are real tables.
    const from = tableToken.get(rel.fromTable);
    const to = tableToken.get(rel.toTable);
    if (!from || !to) continue;
    const label = escLabel(rel.fromColumns.length > 0 ? rel.fromColumns.join(",") : rel.name);
    lines.push(`  ${to} ${relSymbol(rel.cardinality)} ${from} : "${label}"`);
  }

  return `${lines.join("\n")}\n`;
}
