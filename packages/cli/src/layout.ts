import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** A saved node position. */
export interface Position {
  x: number;
  y: number;
}

/** On-disk layout document. Table name → position. */
export interface LayoutFile {
  version: 1;
  positions: Record<string, Position>;
}

const LAYOUT_VERSION = 1 as const;
const LAYOUT_DIR = ".schemat";
const LAYOUT_FILE = "layout.json";

function layoutPath(projectPath: string): string {
  return path.join(projectPath, LAYOUT_DIR, LAYOUT_FILE);
}

/** Narrow an unknown JSON value into a valid LayoutFile, or null if invalid. */
function coerce(value: unknown): LayoutFile | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== LAYOUT_VERSION) return null;
  if (typeof v.positions !== "object" || v.positions === null) return null;

  const positions: Record<string, Position> = {};
  for (const [name, pos] of Object.entries(v.positions as Record<string, unknown>)) {
    if (typeof pos !== "object" || pos === null) continue;
    const p = pos as Record<string, unknown>;
    if (typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      positions[name] = { x: p.x, y: p.y };
    }
  }
  return { version: LAYOUT_VERSION, positions };
}

/**
 * Load saved positions for a project. Returns an empty layout when the file is
 * missing or malformed (a bad layout must never crash the dev server).
 */
export async function loadLayout(projectPath: string): Promise<LayoutFile> {
  try {
    const raw = await readFile(layoutPath(projectPath), "utf8");
    return coerce(JSON.parse(raw)) ?? { version: LAYOUT_VERSION, positions: {} };
  } catch {
    return { version: LAYOUT_VERSION, positions: {} };
  }
}

/**
 * Persist positions to `.schemat/layout.json`. Keys are sorted and the file is
 * pretty-printed so git diffs stay minimal and stable. Written atomically via a
 * temp file + rename so a crash mid-write can't corrupt the layout.
 */
export async function saveLayout(
  projectPath: string,
  positions: Record<string, Position>,
): Promise<void> {
  const sorted: Record<string, Position> = {};
  for (const name of Object.keys(positions).sort()) {
    const p = positions[name];
    if (!p) continue;
    // Round to whole pixels — sub-pixel drift would churn the diff.
    sorted[name] = { x: Math.round(p.x), y: Math.round(p.y) };
  }

  const doc: LayoutFile = { version: LAYOUT_VERSION, positions: sorted };
  const dir = path.join(projectPath, LAYOUT_DIR);
  await mkdir(dir, { recursive: true });

  const target = layoutPath(projectPath);
  // Unique temp name per write so concurrent saves never race on the same path.
  const tmp = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    await rename(tmp, target);
  } catch (err) {
    // Best-effort cleanup of the temp file if the rename never happened.
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
