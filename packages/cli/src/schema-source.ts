import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { IRSchema, SchemaParser } from "@schemat/core";
import { dbmlParser } from "@schemat/parser-dbml";
import { drizzleParser } from "@schemat/parser-drizzle";
import { mikroormParser } from "@schemat/parser-mikroorm";
import { mongooseParser } from "@schemat/parser-mongoose";
import { prismaParser } from "@schemat/parser-prisma";
import { sqlParser } from "@schemat/parser-sql";
import { typeormParser } from "@schemat/parser-typeorm";

/**
 * All parsers Schemat knows about, in detection priority order. Adding a source
 * is a new entry here — nothing else in the CLI changes (the modular seam).
 */
const PARSERS: readonly SchemaParser[] = [
  prismaParser,
  sqlParser,
  dbmlParser,
  drizzleParser,
  typeormParser,
  mikroormParser,
  mongooseParser,
];

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
export const SUPPORTED_SOURCES =
  "Prisma (<root>/prisma/schema.prisma, or a <root>/prisma/schema/ folder), " +
  "SQL (<root>/schema.sql), DBML (<root>/schema.dbml), " +
  "Drizzle (<root>/src/schema.ts, drizzle.config.ts), " +
  "TypeORM (*.entity.ts / @Entity classes), " +
  "MikroORM (@Entity classes importing @mikro-orm/core), " +
  "or Mongoose (models with new Schema({...}))";

/**
 * Scan a monorepo for schemas one level down under common workspace dirs
 * (apps/, packages/, services/, libs/). Returns the sub-paths (relative to
 * `root`) that contain a detectable schema, so the CLI can point the user at
 * the right `--root` instead of just saying "nothing found".
 */
export async function findSchemasInSubdirs(root: string): Promise<string[]> {
  const workspaceDirs = ["apps", "packages", "services", "libs"];
  const found: string[] = [];

  for (const ws of workspaceDirs) {
    const wsPath = path.join(root, ws);
    let entries: string[];
    try {
      const dirents = await readdir(wsPath, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      continue; // workspace dir doesn't exist
    }
    for (const entry of entries) {
      const candidate = path.join(wsPath, entry);
      if (await detectParser(candidate)) {
        found.push(path.join(ws, entry));
      }
    }
  }
  return found.sort();
}

/**
 * Build the "no schema found" error message. When the given root looks like a
 * monorepo (schemas live under apps/*, packages/*, …), list the discovered
 * service paths so the user knows exactly what to pass to `--root`.
 */
export async function noSchemaMessage(projectPath: string): Promise<string> {
  const base =
    `No schema found under ${projectPath}.\n` +
    `Expected ${SUPPORTED_SOURCES}, or pass --root <dir>.`;
  const subdirs = await findSchemasInSubdirs(projectPath);
  if (subdirs.length === 0) return base;

  // Suggest paths relative to the user's cwd, not the resolved projectPath, so
  // the printed `--root` works verbatim even when they ran `schemat --root repo`.
  const list = subdirs
    .map((d) => {
      const rel = path.relative(process.cwd(), path.join(projectPath, d)) || d;
      return `  schemat --root ${rel}`;
    })
    .join("\n");
  return (
    `${base}\n\n` +
    `This looks like a monorepo. Found schemas in ${subdirs.length} sub-project(s) — ` +
    `point --root at one:\n${list}`
  );
}
