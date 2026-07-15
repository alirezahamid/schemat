import type { SchemaChange } from "@alirezahamid/schemat-core";

/**
 * Render a list of schema changes as human-readable text (for terminals and PR
 * comments). Groups by kind with + / - / ~ markers; empty input yields a
 * single "no changes" line. Deterministic — safe to diff/snapshot.
 */
export function renderDiffText(changes: SchemaChange[]): string {
  if (changes.length === 0) return "No schema changes.\n";

  const lines: string[] = [];
  for (const c of changes) {
    switch (c.kind) {
      case "table.added":
        lines.push(`+ table   ${c.table}`);
        break;
      case "table.removed":
        lines.push(`- table   ${c.table}`);
        break;
      case "column.added":
        lines.push(`+ column  ${c.table}.${c.column}`);
        break;
      case "column.removed":
        lines.push(`- column  ${c.table}.${c.column}`);
        break;
      case "column.changed":
        lines.push(`~ column  ${c.table}.${c.column}  (${c.before} → ${c.after})`);
        break;
      case "relation.added":
        lines.push(`+ relation ${c.name}`);
        break;
      case "relation.removed":
        lines.push(`- relation ${c.name}`);
        break;
      case "relation.changed":
        lines.push(`~ relation ${c.name}  (${c.before} → ${c.after})`);
        break;
    }
  }

  const added = changes.filter((c) => c.kind.endsWith(".added")).length;
  const removed = changes.filter((c) => c.kind.endsWith(".removed")).length;
  const changed = changes.filter((c) => c.kind.endsWith(".changed")).length;
  lines.push("");
  lines.push(`${changes.length} change(s): +${added} added, -${removed} removed, ~${changed} changed`);

  return `${lines.join("\n")}\n`;
}

/**
 * Render schema changes as a GitHub-flavoured Markdown block, suitable for a PR
 * comment posted by the drift-check Action. Uses a fenced diff block so + / -
 * lines get red/green highlighting on GitHub.
 */
export function renderDiffMarkdown(changes: SchemaChange[]): string {
  if (changes.length === 0) {
    return "### 🟢 Schemat: schema docs are up to date\n\nNo drift between the committed snapshot and the current schema.\n";
  }

  const body = renderDiffText(changes).trimEnd();
  return (
    "### 🔴 Schemat: schema docs are out of date\n\n" +
    "The committed schema snapshot no longer matches the current schema. " +
    "Regenerate it with `schemat snapshot` and commit the result.\n\n" +
    "```diff\n" +
    `${body}\n` +
    "```\n"
  );
}
