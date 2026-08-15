import { readFile } from "node:fs/promises";
import path from "node:path";

/** Optional project config. Currently only `source` (parser name) is read. */
export interface SchematConfig {
  source?: string;
}

const CONFIG_FILES = ["schemat.config.json", ".schematrc.json"] as const;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid ${name} at ${filePath}: expected a JSON object`);
    }
    const source = (parsed as { source?: unknown }).source;
    if (source !== undefined && typeof source !== "string") {
      throw new Error(`Invalid ${name} at ${filePath}: "source" must be a string`);
    }
    return source === undefined ? {} : { source };
  }
  return null;
}

/** Absolute path of the preferred config file to write (`schemat.config.json`). */
export function configWritePath(projectPath: string): string {
  return path.join(projectPath, "schemat.config.json");
}
