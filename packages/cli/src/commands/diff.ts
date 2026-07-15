import { diff } from "@alirezahamid/schemat-core";
import { renderDiffMarkdown, renderDiffText } from "@alirezahamid/schemat-render/node";
import { resolveSchemaFrom } from "../schema-source";

export interface DiffOptions {
  before: string;
  after: string;
  /** "text" (default), "markdown", or "json". */
  format: "text" | "markdown" | "json";
}

/**
 * `schemat diff <before> <after>` — structural diff between two schema sources.
 * Each side may be a project directory (any detected parser) or a single
 * schema file (.prisma / .sql). Prints the changes; exits non-zero when the
 * two schemas differ so it can gate scripts if desired.
 */
export async function runDiff(options: DiffOptions): Promise<void> {
  const before = await resolveSchemaFrom(options.before);
  if (!before) {
    console.error(`No schema found at "${options.before}" (expected a project dir, .prisma, or .sql).`);
    process.exitCode = 1;
    return;
  }
  const after = await resolveSchemaFrom(options.after);
  if (!after) {
    console.error(`No schema found at "${options.after}" (expected a project dir, .prisma, or .sql).`);
    process.exitCode = 1;
    return;
  }

  const changes = diff(before, after);

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(changes, null, 2)}\n`);
  } else if (options.format === "markdown") {
    process.stdout.write(renderDiffMarkdown(changes));
  } else {
    process.stdout.write(renderDiffText(changes));
  }

  if (changes.length > 0) process.exitCode = 1;
}
