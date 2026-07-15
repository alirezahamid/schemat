import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";
import type {
  Column,
  Enum,
  IRSchema,
  ParserInput,
  Relation,
  SchemaParser,
  Table,
} from "@alirezahamid/schemat-core";
import { IR_VERSION, parseSchema } from "@alirezahamid/schemat-core";

/* -------------------------------------------------------------------------- */
/* Type mapping                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Map a raw SQL type (already uppercased, base name only) to a canonical IR
 * type string. Falls back to the lowercased raw type when unknown.
 */
function canonicalType(rawType: string): string {
  const base = rawType.trim().toUpperCase();
  switch (base) {
    case "VARCHAR":
    case "CHARACTER VARYING":
    case "TEXT":
    case "CHAR":
    case "CHARACTER":
    case "NVARCHAR":
    case "NCHAR":
    case "CITEXT":
      return "string";
    case "INT":
    case "INTEGER":
    case "BIGINT":
    case "SMALLINT":
    case "TINYINT":
    case "SERIAL":
    case "BIGSERIAL":
    case "SMALLSERIAL":
    case "INT2":
    case "INT4":
    case "INT8":
      return "int";
    case "BOOLEAN":
    case "BOOL":
      return "boolean";
    case "TIMESTAMP":
    case "TIMESTAMPTZ":
    case "TIMESTAMP WITH TIME ZONE":
    case "TIMESTAMP WITHOUT TIME ZONE":
    case "DATE":
    case "DATETIME":
    case "TIME":
    case "TIMETZ":
      return "datetime";
    case "NUMERIC":
    case "DECIMAL":
    case "REAL":
    case "DOUBLE":
    case "DOUBLE PRECISION":
    case "FLOAT":
    case "FLOAT4":
    case "FLOAT8":
    case "MONEY":
      return "float";
    case "UUID":
      return "string";
    case "JSON":
    case "JSONB":
      return "json";
    default:
      return base.toLowerCase();
  }
}

/* -------------------------------------------------------------------------- */
/* Preprocessing                                                              */
/* -------------------------------------------------------------------------- */

/** Strip `--` line comments and `/* *\/` block comments, preserving strings. */
function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    // single-quoted string literal
    if (ch === "'") {
      out += ch;
      i++;
      while (i < n) {
        out += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            out += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // line comment
    if (ch === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    // block comment
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Split a SQL script into statements on top-level semicolons. */
function splitStatements(sql: string): string[] {
  const stmts: string[] = [];
  let depth = 0;
  let cur = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === "'") {
      cur += ch;
      i++;
      while (i < n) {
        cur += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            cur += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === ";" && depth === 0) {
      if (cur.trim()) stmts.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}

/** Strip surrounding quotes/backticks/brackets and schema prefix. */
function unquote(ident: string): string {
  let id = ident.trim();
  // take last dotted segment (drop schema/db prefix), respecting quotes
  const parts = splitDotted(id);
  id = parts[parts.length - 1] ?? id;
  id = id.trim();
  if (
    (id.startsWith('"') && id.endsWith('"')) ||
    (id.startsWith("`") && id.endsWith("`"))
  ) {
    return id.slice(1, -1);
  }
  if (id.startsWith("[") && id.endsWith("]")) {
    return id.slice(1, -1);
  }
  return id;
}

/** Split `schema.table` on dots, but not dots inside quotes. */
function splitDotted(id: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let i = 0;
  const n = id.length;
  let quote: string | null = null;
  while (i < n) {
    const ch = id[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "`" || ch === "[") {
      quote = ch === "[" ? "]" : ch;
      cur += ch;
      i++;
      continue;
    }
    if (ch === ".") {
      parts.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  parts.push(cur);
  return parts;
}

/* -------------------------------------------------------------------------- */
/* CREATE TABLE parsing                                                       */
/* -------------------------------------------------------------------------- */

/** Split the inner column-definition list on top-level commas. */
function splitTopLevel(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  let i = 0;
  const n = body.length;
  while (i < n) {
    const ch = body[i];
    if (ch === "'") {
      cur += ch;
      i++;
      while (i < n) {
        cur += body[i];
        if (body[i] === "'") {
          if (body[i + 1] === "'") {
            cur += body[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (cur.trim()) items.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

const TABLE_CONSTRAINT_RE =
  /^\s*(?:CONSTRAINT\s+(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w]+)\s+)?(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)\b/i;

/** Read a single identifier from the start of a string; returns [ident, rest].
 *  Handles quoted forms ("x" / `x` / [x]), plain dotted names (a.b.c), and a
 *  schema-qualified quoted tail (e.g. public."users"). */
function readIdentifier(s: string): [string, string] {
  let t = s.trimStart();
  let prefix = "";

  // Consume any dotted plain-identifier prefix followed by a dot, so a
  // schema-qualified name like public."users" or db.public.tbl parses whole.
  // Loop while we see `<word>.` and the char after the dot starts a new segment.
  for (;;) {
    const seg = /^([A-Za-z_]\w*)\./.exec(t);
    if (!seg) break;
    prefix += seg[0];
    t = t.slice(seg[0].length);
  }

  if (t.startsWith('"')) {
    const end = t.indexOf('"', 1);
    if (end < 0) return [prefix + t, ""];
    return [prefix + t.slice(0, end + 1), t.slice(end + 1)];
  }
  if (t.startsWith("`")) {
    const end = t.indexOf("`", 1);
    if (end < 0) return [prefix + t, ""];
    return [prefix + t.slice(0, end + 1), t.slice(end + 1)];
  }
  if (t.startsWith("[")) {
    const end = t.indexOf("]", 1);
    if (end < 0) return [prefix + t, ""];
    return [prefix + t.slice(0, end + 1), t.slice(end + 1)];
  }
  const m = /^[\w.]+/.exec(t);
  if (m) return [prefix + m[0], t.slice(m[0].length)];
  return [prefix, t];
}

/** Parenthesized column list, e.g. `(a, "b", c)` -> ["a","b","c"]. */
function parseColumnList(s: string): string[] {
  const open = s.indexOf("(");
  const close = matchParen(s, open);
  if (open < 0 || close < 0) return [];
  const inner = s.slice(open + 1, close);
  return splitTopLevel(inner).map(unquote);
}

/** Index of the `)` matching the `(` at index `open`. */
function matchParen(s: string, open: number): number {
  if (open < 0) return -1;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface ParsedInlineFk {
  toTable: string;
  toColumn: string;
}

/** Parse an inline `REFERENCES other(col)` clause from a column def. */
function parseInlineReferences(def: string): ParsedInlineFk | null {
  const m = /\bREFERENCES\s+([\w."`[\]]+)\s*(\([^)]*\))?/i.exec(def);
  if (!m) return null;
  const toTable = unquote(m[1] ?? "");
  let toColumn = "id";
  if (m[2]) {
    const cols = parseColumnList(m[2]);
    if (cols[0]) toColumn = cols[0];
  }
  return { toTable, toColumn };
}

interface ColumnParseResult {
  column: Column;
  inlinePk: boolean;
  inlineUnique: boolean;
  fk: ParsedInlineFk | null;
}

/** Parse a single column definition line. */
function parseColumnDef(def: string): ColumnParseResult | null {
  const [rawName, afterName] = readIdentifier(def);
  const name = unquote(rawName);
  if (!name) return null;
  let rest = afterName.trim();

  // Read the type: first token, plus optional (n[,m]) and multi-word forms.
  const typeMatch =
    /^([A-Za-z_][\w]*(?:\s+(?:VARYING|PRECISION|WITH\s+TIME\s+ZONE|WITHOUT\s+TIME\s+ZONE))?)\s*(\([^)]*\))?/i.exec(
      rest,
    );
  if (!typeMatch) return null;
  const rawType = typeMatch[1] ?? "";
  rest = rest.slice(typeMatch[0].length);

  const upper = def.toUpperCase();
  const nullable = !/\bNOT\s+NULL\b/i.test(def);
  const inlinePk = /\bPRIMARY\s+KEY\b/i.test(def);
  const inlineUnique = /\bUNIQUE\b/i.test(def);

  let defaultVal: string | null = null;
  const defMatch = /\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|COLLATE|GENERATED)\b|$)/is.exec(
    def,
  );
  if (defMatch && defMatch[1]) {
    defaultVal = defMatch[1].trim().replace(/,\s*$/, "");
  }
  void upper;

  const fk = parseInlineReferences(def);

  const column: Column = {
    name,
    type: canonicalType(rawType),
    nullable: inlinePk ? false : nullable,
    isPrimaryKey: inlinePk,
    isUnique: inlineUnique || inlinePk,
    default: defaultVal,
    comment: null,
  };
  return { column, inlinePk, inlineUnique, fk };
}

interface TableResult {
  table: Table;
  relations: Relation[];
}

/** Parse one `CREATE TABLE ...` statement. */
function parseCreateTable(stmt: string): TableResult | null {
  const m = /^CREATE\s+(?:GLOBAL\s+|LOCAL\s+|TEMP(?:ORARY)?\s+|UNLOGGED\s+)*TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(
    stmt,
  );
  if (!m) return null;
  // Read the (possibly quoted, possibly space-containing) identifier that
  // follows the keyword prefix, rather than a char-class that stops at spaces.
  const [rawName, afterName] = readIdentifier(stmt.slice(m[0].length));
  if (!rawName) return null;
  const tableName = unquote(rawName);
  const open = afterName.indexOf("(");
  if (open < 0) return null;
  // Recompute the paren index relative to the full statement for matchParen.
  const openAbs = stmt.length - afterName.length + open;
  const close = matchParen(stmt, openAbs);
  if (close < 0) return null;
  const body = stmt.slice(openAbs + 1, close);
  const items = splitTopLevel(body);

  const columns: Column[] = [];
  const relations: Relation[] = [];
  const pkColumns = new Set<string>();
  const uniqueColumns = new Set<string>();

  for (const item of items) {
    const constraintMatch = TABLE_CONSTRAINT_RE.exec(item);
    if (constraintMatch) {
      const kind = (constraintMatch[1] ?? "").toUpperCase().replace(/\s+/g, " ");
      if (kind === "PRIMARY KEY") {
        for (const c of parseColumnList(item)) pkColumns.add(c);
      } else if (kind === "UNIQUE") {
        for (const c of parseColumnList(item)) uniqueColumns.add(c);
      } else if (kind === "FOREIGN KEY") {
        const rel = parseTableLevelFk(item, tableName);
        if (rel) relations.push(rel);
      }
      // CHECK: ignored
      continue;
    }
    // Skip other non-column noise (e.g. LIKE, PRIMARY without matching above)
    const parsed = parseColumnDef(item);
    if (!parsed) continue;
    columns.push(parsed.column);
    if (parsed.fk) {
      relations.push(makeRelation(tableName, parsed.column.name, parsed.fk));
    }
  }

  // Apply table-level PK / UNIQUE to the columns.
  for (const col of columns) {
    if (pkColumns.has(col.name)) {
      col.isPrimaryKey = true;
      col.isUnique = true;
      col.nullable = false;
    }
    if (uniqueColumns.has(col.name)) {
      col.isUnique = true;
    }
  }

  return {
    table: { name: tableName, columns, comment: null },
    relations,
  };
}

/** Parse a table-level `FOREIGN KEY (a) REFERENCES other (b)` clause. */
function parseTableLevelFk(item: string, fromTable: string): Relation | null {
  const fkMatch = /FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([\w."`[\]]+)\s*(\([^)]*\))?/i.exec(
    item,
  );
  if (!fkMatch) return null;
  const fromColumns = splitTopLevel(fkMatch[1] ?? "").map(unquote);
  const toTable = unquote(fkMatch[2] ?? "");
  const toColumns = fkMatch[3] ? parseColumnList(fkMatch[3]) : ["id"];
  const firstFrom = fromColumns[0] ?? "";
  return {
    name: `${fromTable}_${firstFrom}_fkey`,
    fromTable,
    fromColumns,
    toTable,
    toColumns: toColumns.length > 0 ? toColumns : ["id"],
    cardinality: "one-to-many",
  };
}

function makeRelation(
  fromTable: string,
  fromColumn: string,
  fk: ParsedInlineFk,
): Relation {
  return {
    name: `${fromTable}_${fromColumn}_fkey`,
    fromTable,
    fromColumns: [fromColumn],
    toTable: fk.toTable,
    toColumns: [fk.toColumn],
    cardinality: "one-to-many",
  };
}

/* -------------------------------------------------------------------------- */
/* CREATE TYPE ... AS ENUM parsing                                            */
/* -------------------------------------------------------------------------- */

/** Parse a Postgres `CREATE TYPE name AS ENUM ('a','b')` statement. */
function parseCreateEnum(stmt: string): Enum | null {
  const m = /^CREATE\s+TYPE\s+([\w."`[\]]+)\s+AS\s+ENUM\s*\(([\s\S]*)\)\s*$/i.exec(
    stmt,
  );
  if (!m) return null;
  const name = unquote(m[1] ?? "");
  const values = splitTopLevel(m[2] ?? "")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) => v.replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'"));
  return { name, values };
}

/* -------------------------------------------------------------------------- */
/* Public parser                                                              */
/* -------------------------------------------------------------------------- */

/** Parse a raw SQL DDL string into the canonical IR (unvalidated shape). */
export function parseSql(sql: string): IRSchema {
  const clean = stripComments(sql);
  const statements = splitStatements(clean);

  const tables: Table[] = [];
  const enums: Enum[] = [];
  const relations: Relation[] = [];

  for (const stmt of statements) {
    if (/^CREATE\s+(?:GLOBAL\s+|LOCAL\s+|TEMP(?:ORARY)?\s+|UNLOGGED\s+)*TABLE\b/i.test(stmt)) {
      const res = parseCreateTable(stmt);
      if (res) {
        tables.push(res.table);
        relations.push(...res.relations);
      }
    } else if (/^CREATE\s+TYPE\b/i.test(stmt) && /\bAS\s+ENUM\b/i.test(stmt)) {
      const en = parseCreateEnum(stmt);
      if (en) enums.push(en);
    }
  }

  return { version: IR_VERSION, tables, enums, relations };
}

const CANDIDATE_PATHS = ["schema.sql", "db/schema.sql", "sql/schema.sql"];

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Find the SQL schema file(s) to parse for a project. */
async function resolveFiles(input: ParserInput): Promise<string[]> {
  if (input.files && input.files.length > 0) return input.files;
  for (const rel of CANDIDATE_PATHS) {
    const p = path.join(input.projectPath, rel);
    if (await fileExists(p)) return [p];
  }
  // Any *.sql at the project root.
  const { readdir } = await import("node:fs/promises");
  try {
    const entries = await readdir(input.projectPath);
    const sqls = entries
      .filter((e) => e.toLowerCase().endsWith(".sql"))
      // Sort for a stable, deterministic merge order — readdir order is not
      // guaranteed and would otherwise churn snapshots/diffs across machines.
      .sort()
      .map((e) => path.join(input.projectPath, e));
    if (sqls.length > 0) return sqls;
  } catch {
    /* ignore */
  }
  return [];
}

async function parse(input: ParserInput): Promise<IRSchema> {
  const files = await resolveFiles(input);
  if (files.length === 0) {
    throw new Error(`No SQL schema file found under ${input.projectPath}`);
  }
  const parts: IRSchema[] = [];
  for (const file of files) {
    const sql = await readFile(file, "utf8");
    parts.push(parseSql(sql));
  }
  const merged: IRSchema = {
    version: IR_VERSION,
    tables: parts.flatMap((p) => p.tables),
    enums: parts.flatMap((p) => p.enums),
    relations: parts.flatMap((p) => p.relations),
  };
  return parseSchema(merged);
}

async function detect(projectPath: string): Promise<boolean> {
  for (const rel of CANDIDATE_PATHS) {
    if (await fileExists(path.join(projectPath, rel))) return true;
  }
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(projectPath);
    return entries.some((e) => e.toLowerCase().endsWith(".sql"));
  } catch {
    return false;
  }
}

export const sqlParser: SchemaParser = {
  name: "sql",
  detect,
  parse,
};

export default sqlParser;
