import { stat } from "node:fs/promises";
import path from "node:path";
import type { Invocation } from "./suggest";
import { suggestCommand } from "./suggest";
import { errorBlock } from "./ui";

/**
 * Verify `--root` points at a directory before anything tries to read inside
 * it. Without this, `--root prisma/schema.prisma` surfaces as a raw
 * `ENOTDIR: not a directory, open '…/schema.prisma/schemat.config.json'`.
 *
 * Returns true when it is safe to continue; otherwise prints an actionable
 * message, sets a non-zero exit code, and returns false.
 */
export async function ensureProjectDir(
  projectPath: string,
  invocation: Invocation,
): Promise<boolean> {
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(projectPath)).isDirectory();
  } catch {
    errorBlock(`--root path does not exist: ${projectPath}`, "Pass a project directory, e.g.:", [
      suggestCommand(invocation.command, { root: "." }),
    ]);
    process.exitCode = 1;
    return false;
  }

  if (!isDirectory) {
    const parent = path.relative(process.cwd(), path.dirname(path.dirname(projectPath)));
    errorBlock(
      `--root must be a directory, but ${projectPath} is a file.`,
      "Point --root at the project directory instead, e.g.:",
      [suggestCommand(invocation.command, { root: parent || "." })],
    );
    process.exitCode = 1;
    return false;
  }

  return true;
}

/**
 * A path to show a human. Relative when that stays readable, absolute once the
 * relative form starts climbing out of the cwd with `../../../…`.
 */
export function displayPath(target: string): string {
  const rel = path.relative(process.cwd(), target);
  if (!rel) return target;
  return rel.startsWith("..") ? target : rel;
}
