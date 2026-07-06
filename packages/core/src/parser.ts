import type { IRSchema } from "./ir";

/**
 * Input handed to a parser. `projectPath` is the repo root Schemat was invoked
 * in; `files` are the resolved schema files when the caller already knows them.
 */
export interface ParserInput {
  projectPath: string;
  files?: string[];
}

/**
 * The modular seam. A parser turns one schema source into the canonical IR.
 *
 * Implementations live in their own package (e.g. `schemat-parser-prisma`) and
 * depend only on `schemat-core`. Adding support for a new source is a new
 * package that implements this interface — nothing in core changes.
 */
export interface SchemaParser {
  /** Short stable id, e.g. "prisma". */
  readonly name: string;
  /** True when this source is present in the given project. */
  detect(projectPath: string): Promise<boolean>;
  /** Parse the source into a validated {@link IRSchema}. */
  parse(input: ParserInput): Promise<IRSchema>;
}
