/**
 * Config + dynamic plugin loading for Schemat parsers.
 *
 * schemat.config.json / .schematrc.json (project root):
 * {
 *   "source": "drizzle",
 *   "parsers": ["./my-parser.js", "@org/schemat-parser-foo"]
 * }
 *
 * Each `parsers` entry is an npm package name or a relative path. The module
 * must export a SchemaParser (default export or named `parser` / `default`).
 */

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SchemaParser } from "@schemat/core";

export interface SchematConfig {
  /** Explicit source override (parser name). */
  source?: string;
  /** Extra parsers to load dynamically (npm names or relative paths). */
  parsers?: string[];
}

const CONFIG_FILES = ["schemat.config.json", ".schematrc.json"] as const;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseConfigObject(parsed: unknown, name: string, filePath: string): SchematConfig {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid ${name} at ${filePath}: expected a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  const cfg: SchematConfig = {};
  if (obj.source !== undefined) {
    if (typeof obj.source !== "string") {
      throw new Error(`Invalid ${name} at ${filePath}: "source" must be a string`);
    }
    cfg.source = obj.source;
  }
  if (obj.parsers !== undefined) {
    if (!Array.isArray(obj.parsers) || !obj.parsers.every((x) => typeof x === "string")) {
      throw new Error(`Invalid ${name} at ${filePath}: "parsers" must be an array of strings`);
    }
    cfg.parsers = obj.parsers.filter((x): x is string => typeof x === "string" && x.length > 0);
  }
  return cfg;
}

/**
 * Load the first present config file under `projectPath`. Missing files are
 * skipped; a present but unparseable file throws so bad config is never silent.
 */
export async function loadConfig(projectPath: string): Promise<SchematConfig | null> {
  for (const name of CONFIG_FILES) {
    const filePath = path.join(projectPath, name);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid ${name} at ${filePath}: ${reason}`);
    }
    return parseConfigObject(parsed, name, filePath);
  }
  return null;
}

/** Sync config read (missing → empty). Malformed throws. */
export function loadSchematConfig(projectPath: string): SchematConfig {
  for (const name of CONFIG_FILES) {
    const filePath = path.join(projectPath, name);
    if (!existsSync(filePath)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid ${name} at ${filePath}: ${reason}`);
    }
    return parseConfigObject(parsed, name, filePath);
  }
  return {};
}

/** Absolute path of the preferred config file to write (`schemat.config.json`). */
export function configWritePath(projectPath: string): string {
  return path.join(projectPath, "schemat.config.json");
}

function coerceParser(mod: unknown, label: string): SchemaParser {
  const m = mod as Record<string, unknown> | null;
  const candidates = [m?.default, m?.parser, m?.sequelizeParser, m];
  for (const c of candidates) {
    if (
      c &&
      typeof c === "object" &&
      typeof (c as SchemaParser).name === "string" &&
      typeof (c as SchemaParser).detect === "function" &&
      typeof (c as SchemaParser).parse === "function"
    ) {
      return c as SchemaParser;
    }
  }
  if (m && typeof m === "object") {
    for (const v of Object.values(m)) {
      if (
        v &&
        typeof v === "object" &&
        typeof (v as SchemaParser).name === "string" &&
        typeof (v as SchemaParser).detect === "function" &&
        typeof (v as SchemaParser).parse === "function"
      ) {
        return v as SchemaParser;
      }
    }
  }
  throw new Error(
    `Parser module "${label}" does not export a SchemaParser (need name + detect + parse).`,
  );
}

/**
 * Dynamically import a parser module. Relative paths resolve against projectPath;
 * bare specifiers use Node resolution from projectPath.
 */
export async function loadParserModule(spec: string, projectPath: string): Promise<SchemaParser> {
  const isPath =
    spec.startsWith(".") ||
    spec.startsWith("/") ||
    spec.startsWith("file:") ||
    path.isAbsolute(spec);

  if (isPath) {
    const abs = path.isAbsolute(spec) ? spec : path.resolve(projectPath, spec);
    const mod = await import(pathToFileURL(abs).href);
    return coerceParser(mod, spec);
  }

  try {
    const require = createRequire(path.join(projectPath, "package.json"));
    const resolved = require.resolve(spec);
    const mod = await import(pathToFileURL(resolved).href);
    return coerceParser(mod, spec);
  } catch {
    const mod = await import(spec);
    return coerceParser(mod, spec);
  }
}

export async function loadConfiguredParsers(projectPath: string): Promise<{
  config: SchematConfig;
  parsers: SchemaParser[];
  errors: string[];
}> {
  const config = (await loadConfig(projectPath)) ?? {};
  const parsers: SchemaParser[] = [];
  const errors: string[] = [];
  for (const spec of config.parsers ?? []) {
    try {
      parsers.push(await loadParserModule(spec, projectPath));
    } catch (err) {
      errors.push(
        `Failed to load parser "${spec}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { config, parsers, errors };
}
