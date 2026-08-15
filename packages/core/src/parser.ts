import type { IRSchema } from "./ir";

/**
 * Input handed to a parser. `projectPath` is the repo root Schemat was invoked
 * in; `files` are the resolved schema files when the caller already knows them.
 */
export interface ParserInput {
  projectPath: string;
  files?: string[];
}

export interface ParserResult {
  schema: IRSchema;
  warnings: string[];
}

export type ParserOutput = IRSchema | ParserResult;

export function normalizeParserOutput(output: ParserOutput): ParserResult {
  if (!("schema" in output)) return { schema: output, warnings: [] };
  // A parser may hand back a result without warnings; callers rely on the
  // array always being present, so fill it in rather than making every one
  // of them guard.
  return output.warnings ? output : { schema: output.schema, warnings: [] };
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
  /** Parse source, optionally returning diagnostics alongside validated schema. */
  parse(input: ParserInput): Promise<ParserOutput>;
  /** Files or directories whose changes can affect parse output. Optional for external parsers. */
  watchTargets?(projectPath: string): string[];
}
