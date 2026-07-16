import { stat } from "node:fs/promises";
import path from "node:path";
import type { IRSchema, SchemaParser } from "@schemat/core";
import { prismaParser } from "@schemat/parser-prisma";
import { sqlParser } from "@schemat/parser-sql";

/**
 * All parsers Schemat knows about, in detection priority order. Adding a source
 * is a new entry here — nothing else in the CLI changes (the modular seam).
 */
const PARSERS: readonly SchemaParser[] = [prismaParser, sqlParser];

/** The first parser that detects a schema under `projectPath`, or null. */
export async function detectParser(projectPath: string): Promise<SchemaParser | null> {
  for (const parser of PARSERS) {
    if (await parser.detect(projectPath)) return parser;
  }
  return null;
}

/**
 * Resolve and parse the schema at `projectPath` using the first matching
 * parser. Returns null when no known schema source is present.
 */
export async function resolveSchema(projectPath: string): Promise<IRSchema | null> {
  const parser = await detectParser(projectPath);
  if (!parser) return null;
  return parser.parse({ projectPath });
}

/**
 * Parse a schema from an explicit path, which may be a project directory (any
 * detected parser) or a single schema file (.prisma or .sql). Used by
 * `schemat diff <a> <b>` where each side can be a dir or a file.
 */
export async function resolveSchemaFrom(target: string): Promise<IRSchema | null> {
  const resolved = path.resolve(process.cwd(), target);

  let isDir = false;
  try {
    isDir = (await stat(resolved)).isDirectory();
  } catch {
    return null;
  }

  if (isDir) return resolveSchema(resolved);

  // Single file: pick the parser by extension, pointing it at the file's dir
  // with an explicit files override.
  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".prisma") {
    return prismaParser.parse({
      projectPath: path.dirname(path.dirname(resolved)),
      files: [resolved],
    });
  }
  if (ext === ".sql") {
    return sqlParser.parse({ projectPath: path.dirname(resolved), files: [resolved] });
  }
  return null;
}

/** Human list of the sources Schemat can detect, for error messages. */
export const SUPPORTED_SOURCES = "Prisma (<root>/prisma/schema.prisma) or SQL (<root>/schema.sql)";
