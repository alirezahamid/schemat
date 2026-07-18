import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
// @dbml/core is CommonJS with no default export under verbatimModuleSyntax.
// Import the namespace and resolve the Parser across interop shapes.
import * as dbmlCore from "@dbml/core";
import type {
  Cardinality,
  Column,
  Enum,
  IRSchema,
  ParserInput,
  Relation,
  SchemaParser,
  Table,
} from "@schemat/core";
import { IR_VERSION, parseSchema } from "@schemat/core";

/* -------------------------------------------------------------------------- */
/* @dbml/core interop + minimal shapes we consume                             */
/* -------------------------------------------------------------------------- */

interface DbmlParser {
  parse(src: string, format: "dbml"): DbmlDatabase;
}
const ns = dbmlCore as unknown as {
  Parser?: DbmlParser;
  default?: { Parser?: DbmlParser };
};
const Parser: DbmlParser =
  ns.Parser ??
  ns.default?.Parser ??
  (() => {
    throw new Error("Could not resolve Parser from @dbml/core");
  })();

interface DbmlField {
  name: string;
  type: { type_name: string; args?: string | null };
  pk?: boolean;
  unique?: boolean;
  not_null?: boolean;
  dbdefault?: { value: string | number | boolean; type: string } | null;
  note?: string | null;
  increment?: boolean;
}

interface DbmlTable {
  name: string;
  note?: string | null;
  fields: DbmlField[];
  // Composite primary keys / uniques are expressed via `indexes` in DBML.
  indexes?: { columns: { value: string }[]; pk?: boolean; unique?: boolean }[];
  schema?: { name?: string } | null;
}

interface DbmlEnum {
  name: string;
  values: { name: string }[];
  schema?: { name?: string } | null;
}

interface DbmlRefEndpoint {
  tableName: string;
  fieldNames: string[];
  /** "1" or "*" — the cardinality symbol on this side of the ref. */
  relation: "1" | "*";
  /** Schema this endpoint's table belongs to (null → default/public). */
  schemaName?: string | null;
}

interface DbmlRef {
  endpoints: [DbmlRefEndpoint, DbmlRefEndpoint];
}

interface DbmlSchema {
  name: string;
  tables: DbmlTable[];
  enums: DbmlEnum[];
  refs: DbmlRef[];
}

interface DbmlDatabase {
  schemas: DbmlSchema[];
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

/** Render a DBML default into a stable display string, or null. */
function renderDefault(field: DbmlField): string | null {
  const d = field.dbdefault;
  if (d === null || d === undefined) return null;
  // String defaults render as-is; expression/number/boolean stringify.
  return String(d.value);
}

/**
 * Full type string. DBML's `type_name` already includes any args, e.g.
 * `varchar(255)` or `decimal(10,2)` — the separate `args` field is a redundant
 * copy, so we use `type_name` verbatim.
 */
function renderType(field: DbmlField): string {
  return field.type?.type_name ?? "unknown";
}

function toColumn(field: DbmlField, tableCompositePk: Set<string>): Column {
  const isPk = field.pk === true || tableCompositePk.has(field.name);
  return {
    name: field.name,
    type: renderType(field),
    nullable: field.not_null !== true && !isPk,
    isPrimaryKey: isPk,
    isUnique: field.unique === true || isPk,
    default: renderDefault(field),
    comment: field.note ?? null,
  };
}

function toTable(
  table: DbmlTable,
  qualify: (schema: string | null | undefined, name: string) => string,
): Table {
  // Columns named in a composite `pk` index are primary keys too.
  const compositePk = new Set<string>();
  for (const idx of table.indexes ?? []) {
    if (idx.pk) {
      for (const c of idx.columns) compositePk.add(c.value);
    }
  }
  return {
    name: qualify(table.schema?.name, table.name),
    columns: table.fields.map((f) => toColumn(f, compositePk)),
    comment: table.note ?? null,
  };
}

function toEnum(
  e: DbmlEnum,
  qualify: (schema: string | null | undefined, name: string) => string,
): Enum {
  return { name: qualify(e.schema?.name, e.name), values: e.values.map((v) => v.name) };
}

/** Map a DBML ref's endpoint relations to an IR cardinality. */
function cardinalityOf(a: "1" | "*", b: "1" | "*"): Cardinality {
  if (a === "*" && b === "*") return "many-to-many";
  if (a === "1" && b === "1") return "one-to-one";
  return "one-to-many";
}

/**
 * Schema-qualify a name: `schema.name` when the schema is a real non-default
 * one, else the bare name. Keeps single-schema DBML (the common case) clean
 * while disambiguating `s1.users` vs `s2.users` in multi-schema files.
 */
function qualifyName(schema: string | null | undefined, name: string): string {
  return schema && schema !== "public" ? `${schema}.${name}` : name;
}

/** True when an endpoint's columns exactly match the referenced table's PK. */
function columnsArePk(
  ep: DbmlRefEndpoint,
  qualify: (schema: string | null | undefined, name: string) => string,
  primaryKeys: Map<string, Set<string>>,
): boolean {
  const pk = primaryKeys.get(qualify(ep.schemaName, ep.tableName));
  if (!pk || pk.size === 0) return false;
  return ep.fieldNames.length === pk.size && ep.fieldNames.every((c) => pk.has(c));
}

/**
 * Convert a DBML ref into an IR relation.
 *
 * - 1:N — the FK-owning side is the "many" (`*`) endpoint.
 * - 1:1 — both sides are "1"; the FK owner is the endpoint whose columns are
 *   NOT the referenced table's primary key (the referencing column). If neither
 *   or both look like a PK, fall back to a deterministic order (second endpoint
 *   as owner, matching DBML's `a - b` referencing order).
 * - M:N — no scalar FK, so columns are empty (matches the IR convention for
 *   implicit many-to-many).
 *
 * `qualify` turns an endpoint's (schemaName, tableName) into the same
 * schema-qualified name used for tables, so relations line up across schemas.
 * `primaryKeys` maps a qualified table name to its set of PK column names.
 */
function toRelation(
  ref: DbmlRef,
  index: number,
  qualify: (schema: string | null | undefined, name: string) => string,
  primaryKeys: Map<string, Set<string>>,
): Relation | null {
  const [e1, e2] = ref.endpoints;
  if (!e1 || !e2) return null;
  const cardinality = cardinalityOf(e1.relation, e2.relation);

  let from = e2;
  let to = e1;
  if (cardinality === "one-to-many") {
    // Owner is the `*` side.
    if (e1.relation === "*") {
      from = e1;
      to = e2;
    } else {
      from = e2;
      to = e1;
    }
  } else if (cardinality === "one-to-one") {
    // Prefer the endpoint whose columns are NOT the table's primary key as the
    // FK owner; that's the referencing (foreign-key) column.
    const e1IsPk = columnsArePk(e1, qualify, primaryKeys);
    const e2IsPk = columnsArePk(e2, qualify, primaryKeys);
    if (e1IsPk && !e2IsPk) {
      from = e2;
      to = e1;
    } else if (e2IsPk && !e1IsPk) {
      from = e1;
      to = e2;
    } // else: keep deterministic default (from = e2, to = e1)
  }

  const fromTable = qualify(from.schemaName, from.tableName);
  const toTable = qualify(to.schemaName, to.tableName);
  const fromColumns = cardinality === "many-to-many" ? [] : from.fieldNames;
  const toColumns = cardinality === "many-to-many" ? [] : to.fieldNames;
  const fkName = fromColumns.length > 0 ? fromColumns.join("_") : `rel${index}`;

  return {
    name: `${fromTable}_${fkName}_fkey`,
    fromTable,
    fromColumns,
    toTable,
    toColumns,
    cardinality,
  };
}

/* -------------------------------------------------------------------------- */
/* Source discovery                                                           */
/* -------------------------------------------------------------------------- */

/** Candidate DBML file locations, in priority order. */
const DBML_CANDIDATES = [
  "schema.dbml",
  "database.dbml",
  "dbml/schema.dbml",
  "docs/schema.dbml",
  path.join("db", "schema.dbml"),
];

/** Find the first existing DBML file under `projectPath`, or null. */
async function findDbmlFile(projectPath: string): Promise<string | null> {
  for (const rel of DBML_CANDIDATES) {
    const full = path.join(projectPath, rel);
    try {
      if ((await stat(full)).isFile()) return full;
    } catch {
      // keep looking
    }
  }
  // Fall back to any *.dbml file in the project root (case-insensitive).
  try {
    const entries = await readdir(projectPath, { withFileTypes: true });
    const dbml = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".dbml"))
      .map((e) => e.name)
      .sort();
    if (dbml[0]) return path.join(projectPath, dbml[0]);
  } catch {
    // ignore
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Parser                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Parse DBML source into the @dbml/core model, converting its `CompilerError`
 * (a non-standard error object with a `.diags` array, whose default
 * stringification is a useless "[object Object]") into a readable Error that
 * names the syntax problem and its location.
 */
function parseDbml(src: string, file: string): DbmlDatabase {
  try {
    return Parser.parse(src, "dbml");
  } catch (err) {
    const diags = (err as { diags?: unknown }).diags;
    if (Array.isArray(diags) && diags.length > 0) {
      const messages = diags
        .map(
          (d: { message?: string; location?: { start?: { line?: number; column?: number } } }) => {
            const loc = d.location?.start;
            const at = loc ? ` (line ${loc.line}, column ${loc.column})` : "";
            return `  • ${d.message ?? "syntax error"}${at}`;
          },
        )
        .join("\n");
      throw new Error(`Failed to parse DBML in ${file}:\n${messages}`);
    }
    throw err instanceof Error ? err : new Error(`Failed to parse DBML in ${file}`);
  }
}

async function parse(input: ParserInput): Promise<IRSchema> {
  const file = input.files?.[0] ?? (await findDbmlFile(input.projectPath));
  if (!file) {
    throw new Error(`No .dbml file found under ${input.projectPath}`);
  }
  const src = await readFile(file, "utf8");
  const db = parseDbml(src, file);

  const tables: Table[] = [];
  const enums: Enum[] = [];
  const relations: Relation[] = [];

  // First pass: build a qualified-name -> PK-column-set map, used to orient
  // 1:1 relations (FK owner is the non-PK side).
  const primaryKeys = new Map<string, Set<string>>();
  for (const schema of db.schemas ?? []) {
    for (const t of schema.tables ?? []) {
      const pk = new Set<string>();
      for (const f of t.fields) if (f.pk) pk.add(f.name);
      for (const idx of t.indexes ?? []) {
        if (idx.pk) for (const c of idx.columns) pk.add(c.value);
      }
      primaryKeys.set(qualifyName(t.schema?.name, t.name), pk);
    }
  }

  // Second pass: map tables, enums and refs. DBML supports multiple named
  // schemas; flatten them all, schema-qualifying names to avoid collisions.
  for (const schema of db.schemas ?? []) {
    for (const t of schema.tables ?? []) tables.push(toTable(t, qualifyName));
    for (const e of schema.enums ?? []) enums.push(toEnum(e, qualifyName));
    schema.refs?.forEach((ref, i) => {
      const rel = toRelation(ref, i, qualifyName, primaryKeys);
      if (rel) relations.push(rel);
    });
  }

  return parseSchema({ version: IR_VERSION, tables, enums, relations });
}

async function detect(projectPath: string): Promise<boolean> {
  return (await findDbmlFile(projectPath)) !== null;
}

export const dbmlParser: SchemaParser = {
  name: "dbml",
  detect,
  parse,
};

export default dbmlParser;
