import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { type IRSchema, parseSchema } from "@schemat/core";

const SNAPSHOT_DIR = ".schemat";
const SNAPSHOT_FILE = "schema.snapshot.json";

export function snapshotPath(projectPath: string): string {
  return path.join(projectPath, SNAPSHOT_DIR, SNAPSHOT_FILE);
}

/**
 * Load the committed schema snapshot for a project, or null when there is none
 * (or it is malformed). A malformed snapshot returns null rather than throwing
 * so callers can treat "no valid snapshot" uniformly.
 */
export async function loadSnapshot(projectPath: string): Promise<IRSchema | null> {
  try {
    const raw = await readFile(snapshotPath(projectPath), "utf8");
    return parseSchema(JSON.parse(raw));
  } catch {
    return null;
  }
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
