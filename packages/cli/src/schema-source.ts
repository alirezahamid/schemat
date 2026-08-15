import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { normalizeParserOutput } from "@schemat/core";
import type { IRSchema, ParserResult, SchemaParser } from "@schemat/core";
import { dbmlParser } from "@schemat/parser-dbml";
import { drizzleParser } from "@schemat/parser-drizzle";
import { mikroormParser } from "@schemat/parser-mikroorm";
import { mongooseParser } from "@schemat/parser-mongoose";
import { prismaParser } from "@schemat/parser-prisma";
import { sequelizeParser } from "@schemat/parser-sequelize";
import { sqlParser } from "@schemat/parser-sql";
import { typeormParser } from "@schemat/parser-typeorm";
import { loadConfiguredParsers } from "./config";
import { type Invocation, suggestCommand } from "./suggest";

/**
 * Built-in parsers in auto-detection priority order (specific → weak).
 * SQL is last: its root `*.sql` glob is the weakest signal and must not shadow
 * Drizzle/TypeORM/etc. when a stray seed.sql sits at the project root.
 * Community parsers can be added via `parsers` in schemat.config.json.
 */
const BUILTIN_PARSERS: readonly SchemaParser[] = [
  prismaParser,
  drizzleParser,
  typeormParser,
  mikroormParser,
  mongooseParser,
  sequelizeParser,
  dbmlParser,
  sqlParser,
];

/** Stable built-in parser ids accepted by `--source` / config `source`. */
export const PARSER_NAMES: readonly string[] = BUILTIN_PARSERS.map((p) => p.name);

export function getParserByName(name: string): SchemaParser | undefined {
  return BUILTIN_PARSERS.find((p) => p.name === name);
}

/** Cache of projectPath -> resolved parser list (built-ins + config plugins). */
const parserListCache = new Map<string, SchemaParser[]>();

async function parsersFor(projectPath: string): Promise<SchemaParser[]> {
  const key = path.resolve(projectPath);
  const cached = parserListCache.get(key);
  if (cached) return cached;

  const { parsers: plugins, errors } = await loadConfiguredParsers(key);
  for (const e of errors) console.error(`Warning: ${e}`);

  // Plugins first so a local override can win detection, then built-ins.
  // Dedup by name (plugin wins).
  const pluginNames = new Set(plugins.map((p) => p.name));
  const ordered = [...plugins, ...BUILTIN_PARSERS.filter((p) => !pluginNames.has(p.name))];

  parserListCache.set(key, ordered);
  return ordered;
}

/** Test helper: drop cached parser lists. */
export function clearParserCache(): void {
  parserListCache.clear();
}

/** The first parser that detects a schema under `projectPath`, or null. */
export async function detectParser(projectPath: string): Promise<SchemaParser | null> {
  const parsers = await parsersFor(projectPath);
  for (const parser of parsers) {
    if (await parser.detect(projectPath)) return parser;
  }
  return null;
}

/**
 * Resolve which parser to use.
 * Precedence: explicit `sourceOverride` (CLI `--source`) > config file `source`
 * > first-match auto-detect (plugins + built-ins).
 */
export async function resolveParser(
  projectPath: string,
  sourceOverride?: string,
): Promise<SchemaParser | null> {
  const parsers = await parsersFor(projectPath);

  if (sourceOverride) {
    const fromList = parsers.find((p) => p.name === sourceOverride);
    if (fromList) return fromList;
    const builtin = getParserByName(sourceOverride);
    if (builtin) return builtin;
    throw new Error(
      `Unknown source "${sourceOverride}". Supported: ${PARSER_NAMES.join(", ")} (plus any config plugins).`,
    );
  }

  const { config } = await loadConfiguredParsers(projectPath);
  if (config.source) {
    const fromList = parsers.find((p) => p.name === config.source);
    if (fromList) return fromList;
    const builtin = getParserByName(config.source);
    if (builtin) return builtin;
    throw new Error(
      `Unknown source "${config.source}" in config. Supported: ${PARSER_NAMES.join(", ")} (plus any config plugins).`,
    );
  }

  return detectParser(projectPath);
}

/**
 * Resolve and parse the schema at `projectPath`. Returns null when no known
 * schema source is present (and no override was forced).
 */
export async function resolveSchemaResult(
  projectPath: string,
  source?: string,
): Promise<ParserResult | null> {
  const parser = await resolveParser(projectPath, source);
  if (!parser) return null;
  return normalizeParserOutput(await parser.parse({ projectPath }));
}

export async function resolveSchema(
  projectPath: string,
  source?: string,
): Promise<IRSchema | null> {
  return (await resolveSchemaResult(projectPath, source))?.schema ?? null;
}

/**
 * Parse a schema from an explicit path, which may be a project directory (any
 * detected parser) or a single schema file (.prisma or .sql). Used by
 * `schemat diff <a> <b>` where each side can be a dir or a file.
 */
export async function resolveSchemaFromResult(
  target: string,
  source?: string,
): Promise<ParserResult | null> {
  const resolved = path.resolve(process.cwd(), target);

  let isDir = false;
  try {
    isDir = (await stat(resolved)).isDirectory();
  } catch {
    return null;
  }

  if (isDir) return resolveSchemaResult(resolved, source);

  // Single file: pick the parser by extension, pointing it at the file's dir
  // with an explicit files override.
  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".prisma") {
    return normalizeParserOutput(
      await prismaParser.parse({
        projectPath: path.dirname(path.dirname(resolved)),
        files: [resolved],
      }),
    );
  }
  if (ext === ".sql") {
    return normalizeParserOutput(
      await sqlParser.parse({ projectPath: path.dirname(resolved), files: [resolved] }),
    );
  }
  return null;
}

/** Human list of the sources Schemat can detect, for error messages. */
export const SUPPORTED_SOURCES =
  "Prisma (<root>/prisma/schema.prisma, or a <root>/prisma/schema/ folder), " +
  "Drizzle (<root>/src/schema.ts, drizzle.config.ts), " +
  "TypeORM (*.entity.ts / @Entity classes), " +
  "MikroORM (@Entity classes importing @mikro-orm/core), " +
  "Mongoose (models with new Schema({...})), " +
  "Sequelize (Model.init / sequelize.define), " +
  "DBML (<root>/schema.dbml), " +
  "SQL (<root>/schema.sql), " +
  "or a custom parser listed in schemat.config.json";

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
  // Natural sort so svc2 comes before svc10 (lexical sort reads as broken).
  return found.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/** Max suggestion lines printed for a monorepo before we truncate. */
const MAX_SUGGESTED_ROOTS = 10;

/**
 * Build the "no schema found" error message. When the given root looks like a
 * monorepo (schemas live under apps/*, packages/*, …), list the discovered
 * service paths so the user knows exactly what to pass to `--root`.
 *
 * `invocation` carries the subcommand the user ran, so every printed command is
 * copy-pasteable (`schemat dev --root apps/api`, never a bare `schemat --root`).
 */
export async function noSchemaMessage(
  projectPath: string,
  invocation: Invocation,
): Promise<string> {
  const base =
    `No schema found under ${projectPath}.\n` +
    `Expected ${SUPPORTED_SOURCES}, or pass --root <dir> / --source <parser>.`;
  const subdirs = await findSchemasInSubdirs(projectPath);
  if (subdirs.length === 0) return base;

  // Suggest paths relative to the user's cwd, not the resolved projectPath, so
  // the printed `--root` works verbatim even when they ran `schemat --root repo`.
  const shown = subdirs.slice(0, MAX_SUGGESTED_ROOTS);
  const list = shown
    .map((d) => {
      const rel = path.relative(process.cwd(), path.join(projectPath, d)) || d;
      return `  ${suggestCommand(invocation.command, { root: rel })}`;
    })
    .join("\n");
  const more =
    subdirs.length > shown.length
      ? `\n  … and ${subdirs.length - shown.length} more sub-project(s)`
      : "";
  return (
    `${base}\n\n` +
    `This looks like a monorepo. Found schemas in ${subdirs.length} sub-project(s) — ` +
    `point --root at one:\n${list}${more}`
  );
}

export async function resolveSchemaFrom(target: string, source?: string): Promise<IRSchema | null> {
  return (await resolveSchemaFromResult(target, source))?.schema ?? null;
}

/** Built-in parser list (no config plugins). Useful for docs/tests. */
export function listBuiltinParsers(): readonly SchemaParser[] {
  return BUILTIN_PARSERS;
}
