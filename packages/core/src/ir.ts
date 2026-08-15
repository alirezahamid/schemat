import { z } from "zod";
import { CANONICAL_TYPES, type CanonicalType } from "./types";

/**
 * Canonical intermediate representation (IR) for a database schema.
 *
 * Every parser (Prisma, Drizzle, SQL, ...) produces an {@link IRSchema}; every
 * renderer and the differ consume it. This is the single seam that keeps the
 * system modular: parsers never leak dialect quirks past this boundary.
 *
 * The schemas are defined with zod so we get runtime validation and inferred
 * TypeScript types from one source of truth. Parsers MUST return values that
 * satisfy `IRSchema.parse(...)`.
 *
 * ## Version history
 * - v1: free-form `Column.type` string; no `rawType` / `isList`.
 * - v2: closed {@link CanonicalType} on `Column.type`, plus `rawType` (source
 *   display string) and `isList` (array columns). Snapshot files at v1 must be
 *   regenerated — `parseSchema` rejects the old literal.
 */

/** Relationship cardinality between two tables. */
export const Cardinality = z.enum(["one-to-one", "one-to-many", "many-to-many"]);
export type Cardinality = z.infer<typeof Cardinality>;

/** Closed column-type vocabulary (re-exported as a zod enum for IR validation). */
export const CanonicalTypeSchema = z.enum(CANONICAL_TYPES);
export type { CanonicalType };

/** A single column on a table. */
export const Column = z.object({
  name: z.string().min(1),
  /**
   * Closed canonical type (see {@link CanonicalType}). Differ compares this,
   * not {@link rawType}.
   */
  type: CanonicalTypeSchema,
  /** Original source type string for display (Prisma `String`, SQL `varchar(255)`, …). */
  rawType: z.string().min(1),
  nullable: z.boolean(),
  isPrimaryKey: z.boolean(),
  isUnique: z.boolean(),
  /** True for array / list columns (Prisma `String[]`, SQL `int[]`, …). */
  isList: z.boolean(),
  /** Rendered default expression, or null when there is none. */
  default: z.string().nullable(),
  comment: z.string().nullable(),
});
export type Column = z.infer<typeof Column>;

/** A foreign-key / relationship edge between two tables. */
export const Relation = z.object({
  /** Stable identifier for this edge (used as the diagram edge id). */
  name: z.string().min(1),
  fromTable: z.string().min(1),
  /**
   * Owning-side FK columns. Empty for implicit many-to-many relations, which
   * are backed by a join table Prisma manages and expose no scalar FK.
   */
  fromColumns: z.array(z.string().min(1)),
  toTable: z.string().min(1),
  toColumns: z.array(z.string().min(1)),
  cardinality: Cardinality,
});
export type Relation = z.infer<typeof Relation>;

/** A table (or model / entity, depending on source). */
export const Table = z.object({
  name: z.string().min(1),
  columns: z.array(Column),
  comment: z.string().nullable(),
});
export type Table = z.infer<typeof Table>;

/** A named enum type referenced by columns. */
export const Enum = z.object({
  name: z.string().min(1),
  values: z.array(z.string()),
});
export type Enum = z.infer<typeof Enum>;

/**
 * The whole schema. `version` is the IR format version — bumping it lets the IR
 * evolve without silently breaking cached layouts or older parsers.
 */
export const IRSchema = z.object({
  version: z.literal(2),
  tables: z.array(Table),
  enums: z.array(Enum),
  relations: z.array(Relation),
});
export type IRSchema = z.infer<typeof IRSchema>;

/** Current IR format version. */
export const IR_VERSION = 2 as const;

/** Build an empty, valid IR schema. */
export function emptySchema(): IRSchema {
  return { version: IR_VERSION, tables: [], enums: [], relations: [] };
}

/**
 * Validate and normalize an unknown value into an {@link IRSchema}.
 * Throws a zod error if the value is not a valid IR.
 */
export function parseSchema(value: unknown): IRSchema {
  return IRSchema.parse(value);
}
