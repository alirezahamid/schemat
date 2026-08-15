import type { Column, Enum, IRSchema, Relation } from "./ir";

/** A single structural change between two schema versions. */
export type SchemaChange =
  | { kind: "table.added"; table: string }
  | { kind: "table.removed"; table: string }
  | { kind: "column.added"; table: string; column: string }
  | { kind: "column.removed"; table: string; column: string }
  | {
      kind: "column.changed";
      table: string;
      column: string;
      before: string;
      after: string;
    }
  | { kind: "relation.added"; name: string }
  | { kind: "relation.removed"; name: string }
  | {
      kind: "relation.changed";
      name: string;
      before: string;
      after: string;
    }
  | { kind: "enum.added"; name: string }
  | { kind: "enum.removed"; name: string }
  | {
      kind: "enum.changed";
      name: string;
      before: string;
      after: string;
    };

function columnSignature(col: Column): string {
  const parts = [col.type];
  if (col.nullable) parts.push("nullable");
  if (col.isPrimaryKey) parts.push("pk");
  if (col.isUnique) parts.push("unique");
  if (col.default !== null) parts.push(`default=${col.default}`);
  return parts.join(" ");
}

function relationSignature(rel: Relation): string {
  return [
    `${rel.fromTable}(${rel.fromColumns.join(",")})`,
    "->",
    `${rel.toTable}(${rel.toColumns.join(",")})`,
    rel.cardinality,
  ].join(" ");
}

/**
 * Human-readable enum value list for `enum.changed` before/after fields.
 * Display only — never used for equality (join collides on commas/empties).
 */
function enumDisplay(en: Enum): string {
  return en.values.join(", ");
}

/**
 * Order-sensitive structural equality for enum values.
 *
 * Order is deliberately significant. In PostgreSQL an enum's declaration order
 * defines its sort order (`ORDER BY status` follows it), and in MySQL an ENUM
 * value's ordinal index is part of the stored representation. A reordering is
 * therefore a real schema change a reviewer should see, not cosmetic noise —
 * so it is reported as `enum.changed` like any other value edit.
 */
function enumValuesEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function byName<T extends { name: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.name, item]));
}

/**
 * Compute the structural difference between two schemas.
 *
 * Deterministic and side-effect free. Powers the "what changed" UI and the
 * future schema-drift CI check. Tables and columns are matched by name.
 */
export function diff(before: IRSchema, after: IRSchema): SchemaChange[] {
  const changes: SchemaChange[] = [];

  const beforeTables = byName(before.tables);
  const afterTables = byName(after.tables);

  for (const name of beforeTables.keys()) {
    if (!afterTables.has(name)) changes.push({ kind: "table.removed", table: name });
  }
  for (const name of afterTables.keys()) {
    if (!beforeTables.has(name)) changes.push({ kind: "table.added", table: name });
  }

  // Column-level diff for tables present in both.
  for (const [tableName, beforeTable] of beforeTables) {
    const afterTable = afterTables.get(tableName);
    if (!afterTable) continue;

    const beforeCols = byName(beforeTable.columns);
    const afterCols = byName(afterTable.columns);

    for (const colName of beforeCols.keys()) {
      if (!afterCols.has(colName))
        changes.push({ kind: "column.removed", table: tableName, column: colName });
    }
    for (const [colName, afterCol] of afterCols) {
      const beforeCol = beforeCols.get(colName);
      if (!beforeCol) {
        changes.push({ kind: "column.added", table: tableName, column: colName });
        continue;
      }
      const beforeSig = columnSignature(beforeCol);
      const afterSig = columnSignature(afterCol);
      if (beforeSig !== afterSig) {
        changes.push({
          kind: "column.changed",
          table: tableName,
          column: colName,
          before: beforeSig,
          after: afterSig,
        });
      }
    }
  }

  const beforeRels = byName(before.relations);
  const afterRels = byName(after.relations);
  for (const name of beforeRels.keys()) {
    if (!afterRels.has(name)) changes.push({ kind: "relation.removed", name });
  }
  for (const [name, afterRel] of afterRels) {
    const beforeRel = beforeRels.get(name);
    if (!beforeRel) {
      changes.push({ kind: "relation.added", name });
      continue;
    }
    const beforeSig = relationSignature(beforeRel);
    const afterSig = relationSignature(afterRel);
    if (beforeSig !== afterSig) {
      changes.push({ kind: "relation.changed", name, before: beforeSig, after: afterSig });
    }
  }

  // Enum-level diff. Enums are matched by name; a value added, removed or
  // renamed shows up as an enum.changed carrying the full before/after value
  // lists, mirroring how column.changed carries signatures.
  const beforeEnums = byName(before.enums);
  const afterEnums = byName(after.enums);
  for (const name of beforeEnums.keys()) {
    if (!afterEnums.has(name)) changes.push({ kind: "enum.removed", name });
  }
  for (const [name, afterEnum] of afterEnums) {
    const beforeEnum = beforeEnums.get(name);
    if (!beforeEnum) {
      changes.push({ kind: "enum.added", name });
      continue;
    }
    if (!enumValuesEqual(beforeEnum.values, afterEnum.values)) {
      changes.push({
        kind: "enum.changed",
        name,
        before: enumDisplay(beforeEnum),
        after: enumDisplay(afterEnum),
      });
    }
  }

  return changes;
}
