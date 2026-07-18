import path from "node:path";
import { diff } from "@schemat/core";
import { renderDiffMarkdown, renderDiffText } from "@schemat/render/node";
import { noSchemaMessage, resolveSchema } from "../schema-source";
import { loadSnapshot, snapshotPath } from "../snapshot";

export interface CheckOptions {
  root: string;
  /** Output format: "text" (default) or "markdown" (for PR comments). */
  format: "text" | "markdown";
}

/**
 * `schemat check` — the drift gate for CI. Parses the live schema, diffs it
 * against the committed `.schemat/schema.snapshot.json`, prints the difference,
 * and EXITS NON-ZERO when they diverge so a CI job fails on stale schema docs.
 */
export async function runCheck(options: CheckOptions): Promise<void> {
  const projectPath = path.resolve(process.cwd(), options.root);

  const current = await resolveSchema(projectPath);
  if (!current) {
    console.error(await noSchemaMessage(projectPath));
    process.exitCode = 1;
    return;
  }

  const snapshot = await loadSnapshot(projectPath);
  if (!snapshot) {
    const rel =
      path.relative(process.cwd(), snapshotPath(projectPath)) || snapshotPath(projectPath);
    console.error(
      `No committed snapshot at ${rel}.\nRun \`schemat snapshot\` and commit the result first.`,
    );
    process.exitCode = 1;
    return;
  }

  // Drift = the snapshot (committed docs) no longer matches the live schema.
  const changes = diff(snapshot, current);
  const output =
    options.format === "markdown" ? renderDiffMarkdown(changes) : renderDiffText(changes);
  process.stdout.write(output);

  if (changes.length > 0) {
    // Non-zero exit fails the CI job.
    process.exitCode = 1;
  }
}
