import { access, readFile, readdir } from "node:fs/promises";
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
}

interface DbmlEnum {
  name: string;
  values: { name: string }[];
}

interface DbmlRefEndpoint {
  tableName: string;
  fieldNames: string[];
  /** "1" or "*" — the cardinality symbol on this side of the ref. */
  relation: "1" | "*";
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

function toTable(table: DbmlTable): Table {
  // Columns named in a composite `pk` index are primary keys too.
  const compositePk = new Set<string>();
  for (const idx of table.indexes ?? []) {
    if (idx.pk) {
      for (const c of idx.columns) compositePk.add(c.value);
    }
  }
  return {
    name: table.name,
    columns: table.fields.map((f) => toColumn(f, compositePk)),
    comment: table.note ?? null,
  };
}

function toEnum(e: DbmlEnum): Enum {
  return { name: e.name, values: e.values.map((v) => v.name) };
}

/** Map a DBML ref's endpoint relations to an IR cardinality. */
function cardinalityOf(a: "1" | "*", b: "1" | "*"): Cardinality {
  if (a === "*" && b === "*") return "many-to-many";
  if (a === "1" && b === "1") return "one-to-one";
  return "one-to-many";
}

/**
 * Convert a DBML ref into an IR relation. The FK-owning side is the "many"
 * (`*`) endpoint for 1:N; for 1:1 we treat the second endpoint as the owner
 * (DBML lists the referencing side second in `a > b` style). For M:N there is
 * no scalar FK, matching how the IR represents implicit many-to-many.
 */
function toRelation(ref: DbmlRef, index: number): Relation | null {
  const [e1, e2] = ref.endpoints;
  if (!e1 || !e2) return null;
  const cardinality = cardinalityOf(e1.relation, e2.relation);

  // Owner (FK side) vs referenced (PK side).
  let from = e2;
  let to = e1;
  if (e1.relation === "*" && e2.relation === "1") {
    from = e1;
    to = e2;
  } else if (e1.relation === "1" && e2.relation === "*") {
    from = e2;
    to = e1;
  }

  const fromColumns = cardinality === "many-to-many" ? [] : from.fieldNames;
  const toColumns = cardinality === "many-to-many" ? [] : to.fieldNames;
  const fkName = fromColumns.length > 0 ? fromColumns.join("_") : `rel${index}`;

  return {
    name: `${from.tableName}_${fkName}_fkey`,
    fromTable: from.tableName,
    fromColumns,
    toTable: to.tableName,
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
      await access(full);
      return full;
    } catch {
      // keep looking
    }
  }
  // Fall back to any *.dbml in the project root.
  try {
    const entries = await readdir(projectPath, { withFileTypes: true });
    const dbml = entries
      .filter((e) => e.isFile() && e.name.endsWith(".dbml"))
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

async function parse(input: ParserInput): Promise<IRSchema> {
  const file = input.files?.[0] ?? (await findDbmlFile(input.projectPath));
  if (!file) {
    throw new Error(`No .dbml file found under ${input.projectPath}`);
  }
  const src = await readFile(file, "utf8");
  const db = Parser.parse(src, "dbml");

  const tables: Table[] = [];
  const enums: Enum[] = [];
  const relations: Relation[] = [];

  // DBML supports multiple named schemas; flatten them all.
  for (const schema of db.schemas ?? []) {
    for (const t of schema.tables ?? []) tables.push(toTable(t));
    for (const e of schema.enums ?? []) enums.push(toEnum(e));
    schema.refs?.forEach((ref, i) => {
      const rel = toRelation(ref, i);
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
