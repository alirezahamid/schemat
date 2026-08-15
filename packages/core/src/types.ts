/**
 * Closed vocabulary of column types shared by every parser.
 *
 * Parsers map dialect-specific type text into one of these, and keep the
 * original string on `Column.rawType` for display. The differ compares only
 * `type` (plus flags), so Prisma `String` vs SQL `varchar` no longer false-
 * positives as `column.changed`.
 */
export const CANONICAL_TYPES = [
  "string",
  "int",
  "bigint",
  "float",
  "decimal",
  "boolean",
  "datetime",
  "date",
  "time",
  "json",
  "bytes",
  "uuid",
  "enum",
  "object",
  "array",
  "unknown",
] as const;

export type CanonicalType = (typeof CANONICAL_TYPES)[number];

const CANONICAL_SET = new Set<string>(CANONICAL_TYPES);

/** True when `value` is already a member of the closed vocabulary. */
export function isCanonicalType(value: string): value is CanonicalType {
  return CANONICAL_SET.has(value);
}

/**
 * Map a dialect / ORM type string onto the closed vocabulary.
 *
 * Input is the raw source type (Prisma `String`, SQL `VARCHAR`, Drizzle
 * `serial`, TS `number`, Mongoose `ObjectId`, …). Unknown input becomes
 * `"unknown"` — never leak free-form text into `Column.type`.
 */
export function mapToCanonicalType(rawType: string): CanonicalType {
  const raw = rawType.trim();
  if (!raw) return "unknown";
  if (isCanonicalType(raw)) return raw;

  // Strip SQL/DBML args: varchar(255) / decimal(10,2) / character varying(50)
  const noArgs = raw.replace(/\(.*\)\s*$/, "").trim();
  // Collapse internal whitespace for multi-word SQL types
  const key = noArgs.replace(/\s+/g, " ").toLowerCase();

  switch (key) {
    // ---- strings / text -------------------------------------------------
    case "string":
    case "str":
    case "text":
    case "varchar":
    case "character varying":
    case "char":
    case "character":
    case "nvarchar":
    case "nchar":
    case "ntext":
    case "citext":
    case "tinytext":
    case "mediumtext":
    case "longtext":
    case "bpchar":
    case "name":
    case "clob":
      return "string";

    // ---- integers -------------------------------------------------------
    case "int":
    case "integer":
    case "int2":
    case "int4":
    case "smallint":
    case "tinyint":
    case "mediumint":
    case "serial":
    case "smallserial":
    case "number": // TS / TypeORM default numeric
      return "int";

    // ---- big integers ---------------------------------------------------
    case "bigint":
    case "int8":
    case "bigserial":
    case "unsigned big int":
      return "bigint";

    // ---- floats ---------------------------------------------------------
    case "float":
    case "float4":
    case "float8":
    case "real":
    case "double":
    case "double precision":
    case "doubleprecision":
      return "float";

    // ---- decimal / numeric ----------------------------------------------
    case "decimal":
    case "numeric":
    case "money":
    case "decimal128":
      return "decimal";

    // ---- boolean --------------------------------------------------------
    case "boolean":
    case "bool":
    case "bit":
      return "boolean";

    // ---- datetime / timestamp -------------------------------------------
    case "datetime":
    case "timestamp":
    case "timestamptz":
    case "timestamp with time zone":
    case "timestamp without time zone":
    case "datetime2":
    case "smalldatetime":
      return "datetime";

    case "date":
      return "date";

    case "time":
    case "timetz":
    case "time with time zone":
    case "time without time zone":
      return "time";

    // ---- json -----------------------------------------------------------
    case "json":
    case "jsonb":
    case "mixed":
    case "map":
      return "json";

    // ---- bytes / binary -------------------------------------------------
    case "bytes":
    case "bytea":
    case "blob":
    case "tinyblob":
    case "mediumblob":
    case "longblob":
    case "binary":
    case "varbinary":
    case "buffer":
      return "bytes";

    // ---- uuid -----------------------------------------------------------
    case "uuid":
    case "uniqueidentifier":
      return "uuid";

    // ---- enum / object / array ------------------------------------------
    case "enum":
      return "enum";
    case "object":
    case "objectid":
    case "bson":
      // ObjectId is an identifier; surface as string for cross-source compare
      // of relational shapes, but keep rawType for display.
      if (key === "objectid") return "string";
      return "object";
    case "array":
      return "array";

    // ---- Prisma PascalCase (already lowercased key) ---------------------
    // Prisma emits String/Int/... — covered by lowercased cases above.

    // ---- Drizzle builders -----------------------------------------------
    case "pgtable":
    case "mysqltable":
    case "sqlitetable":
      return "unknown";

    default:
      break;
  }

  // Prefix / contains heuristics for leftovers (vector, geometry, custom).
  if (key.endsWith("[]")) {
    // SQL array type e.g. integer[] — element type ignored; flag isList separately
    return mapToCanonicalType(raw.replace(/\[\]\s*$/, ""));
  }
  if (key.includes("timestamp") || key.includes("datetime")) return "datetime";
  if (key.includes("time")) return "time";
  if (key.includes("json")) return "json";
  if (key.includes("uuid")) return "uuid";
  if (key.includes("bool")) return "boolean";
  if (key.includes("int") || key.includes("serial")) return "int";
  if (key.includes("char") || key.includes("text") || key.includes("clob")) return "string";
  if (key.includes("blob") || key.includes("binary") || key.includes("byte")) return "bytes";
  if (key.includes("decimal") || key.includes("numeric") || key.includes("money")) return "decimal";
  if (key.includes("float") || key.includes("double") || key.includes("real")) return "float";

  return "unknown";
}
