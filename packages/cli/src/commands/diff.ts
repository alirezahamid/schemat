import { diff } from "@schemat/core";
import { renderDiffMarkdown, renderDiffText } from "@schemat/render/node";
import { styleDiffText } from "../diff-style";
import { resolveSchemaFromResult } from "../schema-source";
import { errorBlock, warning } from "../ui";

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
  for (const text of beforeResult?.warnings ?? []) warning(text);
  if (!before) {
    errorBlock(
      `No schema found at "${options.before}".`,
      "Expected a project dir, a .prisma file, or a .sql file.",
    );
    process.exitCode = 1;
    return;
  }
  const afterResult = await resolveSchemaFromResult(options.after, options.source);
  const after = afterResult?.schema ?? null;
  for (const text of afterResult?.warnings ?? []) warning(text);
  if (!after) {
    errorBlock(
      `No schema found at "${options.after}".`,
      "Expected a project dir, a .prisma file, or a .sql file.",
    );
    process.exitCode = 1;
    return;
  }

  const changes = diff(before, after);

  // json / markdown are consumed by other programs: emit them exactly as the
  // renderer produced them, with no styling of any kind.
  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(changes, null, 2)}\n`);
  } else if (options.format === "markdown") {
    process.stdout.write(renderDiffMarkdown(changes));
  } else {
    process.stdout.write(styleDiffText(renderDiffText(changes), process.stdout));
  }

  if (changes.length > 0) process.exitCode = 1;
}
