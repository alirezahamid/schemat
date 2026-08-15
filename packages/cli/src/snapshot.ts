import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { type IRSchema, parseSchema } from "@schemat/core";

const SNAPSHOT_DIR = ".schemat";
const SNAPSHOT_FILE = "schema.snapshot.json";

export function snapshotPath(projectPath: string): string {
  return path.join(projectPath, SNAPSHOT_DIR, SNAPSHOT_FILE);
}

/** Load the committed schema snapshot, or null only when the file is missing. */
export async function loadSnapshot(projectPath: string): Promise<IRSchema | null> {
  const target = snapshotPath(projectPath);
  let raw: string;
  try {
    raw = await readFile(target, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }

  try {
    return parseSchema(JSON.parse(raw));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`snapshot file exists but is invalid: ${target}: ${reason}`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * Persist an IR schema to `.schemat/schema.snapshot.json`. Keys are serialised
 * in a stable order and pretty-printed so git diffs stay minimal and reviewable.
 * Written atomically (temp file + rename) so a crash mid-write can't corrupt it.
 */
export async function saveSnapshot(projectPath: string, schema: IRSchema): Promise<void> {
  const dir = path.join(projectPath, SNAPSHOT_DIR);
  await mkdir(dir, { recursive: true });

  const target = snapshotPath(projectPath);
  const tmp = `${target}.${randomUUID()}.tmp`;
  const doc = `${JSON.stringify(schema, null, 2)}\n`;
  try {
    await writeFile(tmp, doc, "utf8");
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
