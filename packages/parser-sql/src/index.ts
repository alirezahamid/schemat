import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";
import type {
  Column,
  Enum,
  IRSchema,
  ParserInput,
  ParserResult,
  Relation,
  SchemaParser,
  Table,
} from "@schemat/core";
import { IR_VERSION, parseSchema } from "@schemat/core";

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

/**
 * If a dollar-quote opener (`$$` or `$tag$`) starts at `i`, return the opening
 * token; otherwise null. Postgres tags are `[A-Za-z_][A-Za-z0-9_]*`.
 */
function matchDollarTag(sql: string, i: number): string | null {
  if (sql[i] !== "$") return null;
  const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
  return m ? m[0] : null;
}

/** Index just past the matching dollar-quote closer, or null when missing. */
function findDollarEnd(sql: string, from: number, tag: string): number | null {
  const close = sql.indexOf(tag, from);
  return close === -1 ? null : close + tag.length;
}

/** Copy a single- or double-quoted span (handles doubled-quote escapes). */
function copyQuoted(sql: string, start: number, quote: "'" | '"'): [string, number] {
  const n = sql.length;
  let i = start;
  let out = sql[i] ?? "";
  i++;
  while (i < n) {
    const ch = sql[i] ?? "";
    out += ch;
    if (ch === quote) {
      if (sql[i + 1] === quote) {
        out += sql[i + 1] ?? "";
        i += 2;
        continue;
      }
      i++;
      break;
    }
    i++;
  }
  return [out, i];
}

/** Strip `--` line comments and `/* *\/` block comments, preserving strings. */
function stripComments(sql: string, warnings: string[]): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    // double-quoted identifier: opaque before dollar-tag scan (Postgres `"$func$"`)
    if (ch === '"') {
      const [chunk, nextI] = copyQuoted(sql, i, '"');
      out += chunk;
      i = nextI;
      continue;
    }
    // dollar-quoted body ($$ ... $$ / $tag$ ... $tag$): opaque, copied verbatim
    const dollarTag = matchDollarTag(sql, i);
    if (dollarTag) {
      const end = findDollarEnd(sql, i + dollarTag.length, dollarTag);
      if (end === null) {
        const line = sql.slice(0, i).split("\n").length;
        warnings.push(
          `Unterminated SQL dollar quote "${dollarTag}" opened at line ${line}; input from that point on could not be parsed.`,
        );
      }
      out += sql.slice(i, end ?? sql.length);
      i = end ?? sql.length;
      continue;
    }
    // single-quoted string literal
    if (ch === "'") {
      const [chunk, nextI] = copyQuoted(sql, i, "'");
      out += chunk;
      i = nextI;
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
    // double-quoted identifier first so `"$func$"` is not a dollar tag
    if (ch === '"') {
      const [chunk, nextI] = copyQuoted(sql, i, '"');
      cur += chunk;
      i = nextI;
      continue;
    }
    // A dollar-quoted body is one opaque unit — semicolons inside it must not
    // split the enclosing CREATE FUNCTION into fragments.
    const dollarTag = matchDollarTag(sql, i);
    if (dollarTag) {
      const end = findDollarEnd(sql, i + dollarTag.length, dollarTag);
      cur += sql.slice(i, end ?? sql.length);
      i = end ?? sql.length;
      continue;
    }
    if (ch === "'") {
      const [chunk, nextI] = copyQuoted(sql, i, "'");
      cur += chunk;
      i = nextI;
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
  if ((id.startsWith('"') && id.endsWith('"')) || (id.startsWith("`") && id.endsWith("`"))) {
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
/** Leading `KEY` / `INDEX` token, with the MySQL-only index qualifiers. */
const INDEX_PREFIX_RE = /^\s*(?:(UNIQUE|FULLTEXT|SPATIAL)\s+)?(?:KEY|INDEX)\b/i;
/** Parenthesised content that is a type length/precision, e.g. `(255)`, `(3, 1)`. */
const TYPE_ARGS_RE = /^\s*\d+\s*(?:,\s*\d+\s*)*$/;
/** Clauses that can only follow a column's type, never an index column list. */
const COLUMN_TAIL_RE =
  /^(?:NOT\s+NULL|NULL|DEFAULT|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|COLLATE|GENERATED|ARRAY|\[\s*\])\b/i;
/** Type names that may carry a parenthesised argument, e.g. `key geometry(Point,4326)`. */
const PARAMETERIZED_TYPE_RE =
  /^(?:VARCHAR|CHAR|CHARACTER|NVARCHAR|NCHAR|VARBINARY|BINARY|BIT|TEXT|NUMERIC|DECIMAL|FLOAT|DOUBLE|REAL|INT|INTEGER|BIGINT|SMALLINT|TINYINT|MEDIUMINT|TIME|TIMESTAMP|TIMESTAMPTZ|DATETIME|INTERVAL|GEOMETRY|GEOGRAPHY|ENUM|SET|VECTOR)$/i;

/**
 * Decide whether a `CREATE TABLE` item is a MySQL inline index definition.
 *
 * This is deliberately SHAPE-aware rather than first-token-aware: `key` and
 * `index` are unreserved keywords in PostgreSQL and are perfectly legal column
 * names, so `key text NOT NULL` is a COLUMN while `KEY idx (col)` is an INDEX.
 * An item only counts as an index when the `KEY`/`INDEX` token is followed by
 * an optional index name, an optional `USING <type>`, and then a parenthesised
 * column list.
 */
function isInlineIndexDefinition(item: string): boolean {
  const prefix = INDEX_PREFIX_RE.exec(item);
  if (!prefix) return false;

  let rest = item.slice(prefix[0].length).trimStart();

  // `KEY (col)` / `UNIQUE KEY (col)` - unnamed index, column list follows.
  if (rest.startsWith("(")) return true;

  // Optional index name.
  const [name, afterName] = readIdentifier(rest);
  // `UNIQUE KEY` / `FULLTEXT` / `SPATIAL` qualifiers never introduce a column.
  if (!name) return Boolean(prefix[1]);
  rest = afterName.trimStart();

  // MySQL allows `KEY idx USING BTREE (col)`.
  const using = /^USING\s+\w+/i.exec(rest);
  if (using) return rest.slice(using[0].length).trimStart().startsWith("(");

  // No parenthesised list => this is `key <type> ...`, i.e. a column.
  if (!rest.startsWith("(")) return false;

  // Ambiguous shape: `KEY idx (col)` (index) vs `key varchar(255)` (column).
  const close = matchParen(rest, 0);
  const inner = close < 0 ? rest.slice(1) : rest.slice(1, close);
  // A length/precision argument means the preceding token was a type.
  if (TYPE_ARGS_RE.test(inner)) return false;
  // A known parameterised type name means the preceding token was a type.
  if (PARAMETERIZED_TYPE_RE.test(name.replace(/^["`[]|["`\]]$/g, ""))) return false;
  // A column-only tail (e.g. `index geometry(Point,4326) NOT NULL`) likewise.
  const tail = close < 0 ? "" : rest.slice(close + 1).trimStart();
  if (COLUMN_TAIL_RE.test(tail)) return false;

  return true;
}

/** Read a dotted identifier from the start of a string; returns [ident, rest].
 * Handles quoted ("x" / `x` / [x]) and unquoted segments in any combination. */
function readIdentifier(s: string): [string, string] {
  const t = s.trimStart();
  let end = 0;

  const readSegment = (start: number): number => {
    const opener = t[start];
    if (opener === '"' || opener === "`" || opener === "[") {
      const closer = opener === "[" ? "]" : opener;
      const close = t.indexOf(closer, start + 1);
      return close < 0 ? t.length : close + 1;
    }
    const match = /^[A-Za-z_]\w*/.exec(t.slice(start));
    return match ? start + match[0].length : start;
  };

  end = readSegment(0);
  if (end === 0) return ["", t];
  while (t[end] === ".") {
    const segmentEnd = readSegment(end + 1);
    if (segmentEnd === end + 1) break;
    end = segmentEnd;
  }
  return [t.slice(0, end), t.slice(end)];
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
  const defMatch =
    /\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|COLLATE|GENERATED)\b|$)/is.exec(
      def,
    );
  if (defMatch?.[1]) {
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
function parseCreateTable(stmt: string, warnings: string[] = []): TableResult | null {
  const m =
    /^CREATE\s+(?:GLOBAL\s+|LOCAL\s+|TEMP(?:ORARY)?\s+|UNLOGGED\s+)*TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(
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
    if (isInlineIndexDefinition(item)) {
      if (/^\s*UNIQUE\s+(?:KEY|INDEX)\b/i.test(item)) {
        for (const c of parseColumnList(item)) uniqueColumns.add(c);
      }
      continue;
    }
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
      if (kind === "CHECK") {
        warnings.push(
          `SQL CHECK constraint on table "${tableName}" is not represented; constraint skipped.`,
        );
      }
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

function makeRelation(fromTable: string, fromColumn: string, fk: ParsedInlineFk): Relation {
  return {
    name: `${fromTable}_${fromColumn}_fkey`,
    fromTable,
    fromColumns: [fromColumn],
    toTable: fk.toTable,
    toColumns: [fk.toColumn],
    cardinality: "one-to-many",
  };
}

function applyAlterConstraint(stmt: string, tables: Table[], relations: Relation[]): void {
  const prefix = /^ALTER\s+TABLE\s+(?:ONLY\s+)?/i.exec(stmt);
  if (!prefix) return;
  const [rawTable, rest] = readIdentifier(stmt.slice(prefix[0].length));
  const tableName = unquote(rawTable);
  const table = tables.find((candidate) => candidate.name === tableName);
  if (!table) return;
  const add = /^\s*ADD\s+(?:CONSTRAINT\s+(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w]+)\s+)?/i.exec(rest);
  if (!add) return;
  const body = rest.slice(add[0].length);
  if (/^PRIMARY\s+KEY\b/i.test(body)) {
    for (const name of parseColumnList(body)) {
      const column = table.columns.find((candidate) => candidate.name === name);
      if (column) Object.assign(column, { isPrimaryKey: true, isUnique: true, nullable: false });
    }
  } else if (/^UNIQUE\b/i.test(body)) {
    for (const name of parseColumnList(body)) {
      const column = table.columns.find((candidate) => candidate.name === name);
      if (column) column.isUnique = true;
    }
  } else if (/^FOREIGN\s+KEY\b/i.test(body)) {
    const relation = parseTableLevelFk(body, tableName);
    if (relation) relations.push(relation);
  }
}

/** Apply an unconditional, single-column PostgreSQL unique index to the IR. */
function applyUniqueIndex(stmt: string, tables: Table[]): void {
  const prefix = /^CREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(
    stmt,
  );
  if (!prefix) return;

  // Index name is irrelevant to the IR, but must be consumed before ON.
  const [, afterIndexName] = readIdentifier(stmt.slice(prefix[0].length));
  const on = /^\s*ON\s+(?:ONLY\s+)?/i.exec(afterIndexName);
  if (!on) return;
  const [rawTable, afterTable] = readIdentifier(afterIndexName.slice(on[0].length));
  if (!rawTable) return;

  // Optional access method appears between table and indexed expression list.
  const rest = afterTable.replace(/^\s*USING\s+\w+/i, "").trimStart();
  const open = rest.indexOf("(");
  const close = matchParen(rest, open);
  if (open !== 0 || close < 0) return;
  // Partial uniqueness is conditional, so cannot become Column.isUnique.
  if (/^\s*WHERE\b/i.test(rest.slice(close + 1))) return;

  const columns = parseColumnList(rest);
  // Composite uniqueness does not imply uniqueness of either individual column.
  if (columns.length !== 1) return;
  const table = tables.find((candidate) => candidate.name === unquote(rawTable));
  const column = table?.columns.find((candidate) => candidate.name === columns[0]);
  if (column) column.isUnique = true;
}

/* -------------------------------------------------------------------------- */
/* CREATE TYPE ... AS ENUM parsing                                            */
/* -------------------------------------------------------------------------- */

/** Parse a Postgres `CREATE TYPE name AS ENUM ('a','b')` statement. */
function parseCreateEnum(stmt: string): Enum | null {
  const m = /^CREATE\s+TYPE\s+([\w."`[\]]+)\s+AS\s+ENUM\s*\(([\s\S]*)\)\s*$/i.exec(stmt);
  if (!m) return null;
  const name = unquote(m[1] ?? "");
  const values = splitTopLevel(m[2] ?? "")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) => v.replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'"));
  return { name, values };
}

/* -------------------------------------------------------------------------- */
/* Unmatched-statement classification                                         */
/* -------------------------------------------------------------------------- */

/**
 * Statements a schema dump routinely contains that Schemat deliberately does
 * not model. These are not gaps a user can act on, so they never warn.
 */
const IGNORED_STATEMENT_PATTERNS: RegExp[] = [
  // Session/runtime settings and psql plumbing.
  /^SET\b/i,
  /^RESET\b/i,
  /^SELECT\s+(?:pg_catalog\.)?set_config\b/i,
  /^\\/, // psql meta commands (\connect, \restrict, ...)
  /^(?:BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/i,
  // Extensions, comments, ownership, privileges.
  /^(?:CREATE|DROP|ALTER)\s+EXTENSION\b/i,
  /^COMMENT\s+ON\b/i,
  /^(?:GRANT|REVOKE)\b/i,
  /^ALTER\s+(?:\w+\s+)*?\S+\s+OWNER\s+TO\b/i,
  /^ALTER\s+DEFAULT\s+PRIVILEGES\b/i,
  // Objects outside the ER model: routines, triggers, indexes, views, etc.
  /^(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|TRIGGER|RULE|POLICY|AGGREGATE|OPERATOR|CAST|COLLATION|SERVER|PUBLICATION|SUBSCRIPTION|EVENT\s+TRIGGER|TEXT\s+SEARCH\s+\w+)\b/i,
  /^(?:CREATE|ALTER|DROP)\s+(?:UNIQUE\s+)?INDEX\b/i,
  /^(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:MATERIALIZED\s+)?VIEW\b/i,
  /^(?:CREATE|ALTER|DROP)\s+(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?SEQUENCE\b/i,
  /^(?:CREATE|ALTER|DROP)\s+SCHEMA\b/i,
  /^(?:CREATE|ALTER|DROP)\s+(?:DATABASE|ROLE|USER|TABLESPACE)\b/i,
  // Data, not schema.
  /^(?:INSERT|UPDATE|DELETE|COPY|TRUNCATE|ANALYZE|VACUUM|REFRESH)\b/i,
  /^SELECT\s+pg_catalog\.setval\b/i,
];

/** True when the statement is an expected dump artifact Schemat ignores. */
function isIntentionallyIgnored(stmt: string): boolean {
  return IGNORED_STATEMENT_PATTERNS.some((re) => re.test(stmt));
}

/** Coarse statement kind ("CREATE TYPE", "LOCK", ...) used to group warnings. */
function statementKind(stmt: string): string {
  const words = stmt.split(/\s+/).filter(Boolean);
  const head = (words[0] ?? "").toUpperCase();
  if (head === "CREATE" || head === "ALTER" || head === "DROP") {
    const rest = words
      .slice(1)
      .map((w) => w.toUpperCase())
      .filter(
        (w) =>
          !["OR", "REPLACE", "UNIQUE", "GLOBAL", "LOCAL", "TEMP", "TEMPORARY", "UNLOGGED"].includes(
            w,
          ),
      );
    return `${head} ${rest[0] ?? ""}`.trim();
  }
  return head;
}

const MAX_WARNING_EXAMPLES = 2;
const MAX_EXAMPLE_LENGTH = 120;

/** Collapse a statement to a single line, capped for readability. */
function summarizeStatement(stmt: string): string {
  const flat = stmt.replace(/\s+/g, " ").trim();
  return flat.length > MAX_EXAMPLE_LENGTH ? `${flat.slice(0, MAX_EXAMPLE_LENGTH)}...` : flat;
}

/**
 * Turn every genuinely unsupported statement into a bounded summary: one
 * warning per statement kind, with a capped number of examples, instead of one
 * warning per statement.
 */
function summarizeUnsupported(statements: string[]): string[] {
  const byKind = new Map<string, string[]>();
  for (const stmt of statements) {
    const kind = statementKind(stmt) || "SQL";
    const bucket = byKind.get(kind);
    if (bucket) bucket.push(stmt);
    else byKind.set(kind, [stmt]);
  }
  const out: string[] = [];
  for (const [kind, group] of byKind) {
    if (group.length === 1) {
      out.push(
        `Unsupported SQL statement "${summarizeStatement(group[0] ?? "")}"; statement skipped.`,
      );
      continue;
    }
    const examples = group
      .slice(0, MAX_WARNING_EXAMPLES)
      .map((stmt) => `"${summarizeStatement(stmt)}"`)
      .join("; ");
    out.push(`Unsupported SQL: ${group.length} ${kind} statements skipped (e.g. ${examples}).`);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Public parser                                                              */
/* -------------------------------------------------------------------------- */

/** Parse a raw SQL DDL string into the canonical IR (unvalidated shape). */
export function parseSql(sql: string, warnings: string[] = []): IRSchema {
  const clean = stripComments(sql, warnings);
  const statements = splitStatements(clean);

  const tables: Table[] = [];
  const enums: Enum[] = [];
  const relations: Relation[] = [];
  const unsupported: string[] = [];

  for (const stmt of statements) {
    if (/^CREATE\s+(?:GLOBAL\s+|LOCAL\s+|TEMP(?:ORARY)?\s+|UNLOGGED\s+)*TABLE\b/i.test(stmt)) {
      const res = parseCreateTable(stmt, warnings);
      if (res) {
        tables.push(res.table);
        relations.push(...res.relations);
      }
    } else if (/^CREATE\s+TYPE\b/i.test(stmt) && /\bAS\s+ENUM\b/i.test(stmt)) {
      const en = parseCreateEnum(stmt);
      if (en) enums.push(en);
    } else if (!/^ALTER\s+TABLE\b/i.test(stmt) && !isIntentionallyIgnored(stmt)) {
      unsupported.push(stmt);
    }
  }

  warnings.push(...summarizeUnsupported(unsupported));

  for (const stmt of statements) {
    applyAlterConstraint(stmt, tables, relations);
    applyUniqueIndex(stmt, tables);
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

async function parse(input: ParserInput): Promise<ParserResult> {
  const files = await resolveFiles(input);
  if (files.length === 0) {
    throw new Error(`No SQL schema file found under ${input.projectPath}`);
  }
  const parts: IRSchema[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    const sql = await readFile(file, "utf8");
    parts.push(parseSql(sql, warnings));
  }
  const merged: IRSchema = {
    version: IR_VERSION,
    tables: parts.flatMap((p) => p.tables),
    enums: parts.flatMap((p) => p.enums),
    relations: parts.flatMap((p) => p.relations),
  };
  return { schema: parseSchema(merged), warnings };
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
  watchTargets: (projectPath) => CANDIDATE_PATHS.map((rel) => path.join(projectPath, rel)),
};

export default sqlParser;
