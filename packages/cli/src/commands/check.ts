import path from "node:path";
import { diff } from "@schemat/core";
import { renderDiffMarkdown, renderDiffText } from "@schemat/render/node";
import { styleDiffText } from "../diff-style";
import { ensureProjectDir } from "../project-path";
import { noSchemaMessage, resolveSchemaResult } from "../schema-source";
import { loadSnapshot, snapshotPath } from "../snapshot";
import { suggestCommand } from "../suggest";
import { errorBlock, warning } from "../ui";

export interface CheckOptions {
  root: string;
  /** Output format: "text" (default) or "markdown" (for PR comments). */
  format: "text" | "markdown";
  source?: string;
}

/**
 * `schemat check` — the drift gate for CI. Parses the live schema, diffs it
 * against the committed `.schemat/schema.snapshot.json`, prints the difference,
 * and EXITS NON-ZERO when they diverge so a CI job fails on stale schema docs.
 */
export async function runCheck(options: CheckOptions): Promise<void> {
  const projectPath = path.resolve(process.cwd(), options.root);
  if (!(await ensureProjectDir(projectPath, { command: "check", root: options.root }))) return;

  const result = await resolveSchemaResult(projectPath, options.source);
  const current = result?.schema ?? null;
  const warnings = result?.warnings ?? [];
  for (const text of warnings) warning(text);
  if (!current) {
    errorBlock(await noSchemaMessage(projectPath, { command: "check", root: options.root }));
    process.exitCode = 1;
    return;
  }

  const snapshot = await loadSnapshot(projectPath);
  if (!snapshot) {
    const rel =
      path.relative(process.cwd(), snapshotPath(projectPath)) || snapshotPath(projectPath);
    errorBlock(
      `No committed snapshot at ${rel}.`,
      "Take a snapshot and commit it, so check has a baseline to compare against.",
      [suggestCommand("snapshot", { root: options.root })],
    );
    process.exitCode = 1;
    return;
  }

  // Drift = the snapshot (committed docs) no longer matches the live schema.
  const changes = diff(snapshot, current);
  if (options.format === "markdown") {
    // Machine-readable: byte-clean, never styled. The markdown report is what
    // the Action posts on a PR, so the command it tells the reader to run must
    // carry their --root.
    process.stdout.write(
      renderDiffMarkdown(changes, {
        snapshotCommand: suggestCommand("snapshot", { root: options.root }),
      }),
    );
  } else {
    process.stdout.write(styleDiffText(renderDiffText(changes), process.stdout));
  }

  if (changes.length > 0) {
    // Non-zero exit fails the CI job.
    process.exitCode = 1;
  }
}
