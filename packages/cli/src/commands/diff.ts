import { diff } from "@schemat/core";
import { renderDiffMarkdown, renderDiffText } from "@schemat/render/node";
import { resolveSchemaFromResult } from "../schema-source";

export interface DiffOptions {
  before: string;
  after: string;
  /** "text" (default), "markdown", or "json". */
  format: "text" | "markdown" | "json";
  /** Force a parser for directory sides (CLI `--source`). */
  source?: string;
}

/**
 * `schemat diff <before> <after>` — structural diff between two schema sources.
 * Each side may be a project directory (any detected parser) or a single
 * schema file (.prisma / .sql). Prints the changes; exits non-zero when the
 * two schemas differ so it can gate scripts if desired.
 */
export async function runDiff(options: DiffOptions): Promise<void> {
  const beforeResult = await resolveSchemaFromResult(options.before, options.source);
  const before = beforeResult?.schema ?? null;
  for (const warning of beforeResult?.warnings ?? []) console.error(`Warning: ${warning}`);
  if (!before) {
    console.error(
      `No schema found at "${options.before}" (expected a project dir, .prisma, or .sql).`,
    );
    process.exitCode = 1;
    return;
  }
  const afterResult = await resolveSchemaFromResult(options.after, options.source);
  const after = afterResult?.schema ?? null;
  for (const warning of afterResult?.warnings ?? []) console.error(`Warning: ${warning}`);
  if (!after) {
    console.error(
      `No schema found at "${options.after}" (expected a project dir, .prisma, or .sql).`,
    );
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
