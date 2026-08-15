import path from "node:path";
import { diff } from "@schemat/core";
import { renderDiffMarkdown, renderDiffText } from "@schemat/render/node";
import { ensureProjectDir } from "../project-path";
import { noSchemaMessage, resolveSchemaResult } from "../schema-source";
import { loadSnapshot, snapshotPath } from "../snapshot";
import { suggestCommand } from "../suggest";

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
  for (const warning of warnings) console.error(`Warning: ${warning}`);
  if (!current) {
    console.error(await noSchemaMessage(projectPath, { command: "check", root: options.root }));
    process.exitCode = 1;
    return;
  }

  const snapshot = await loadSnapshot(projectPath);
  if (!snapshot) {
    const rel =
      path.relative(process.cwd(), snapshotPath(projectPath)) || snapshotPath(projectPath);
    console.error(
      `No committed snapshot at ${rel}.\n` +
        `Run \`${suggestCommand("snapshot", { root: options.root })}\` and commit the result first.`,
    );
    process.exitCode = 1;
    return;
  }

  // Drift = the snapshot (committed docs) no longer matches the live schema.
  const changes = diff(snapshot, current);
  const output =
    options.format === "markdown"
      ? // The markdown report is what the Action posts on a PR, so the command
        // it tells the reader to run must carry their --root.
        renderDiffMarkdown(changes, {
          snapshotCommand: suggestCommand("snapshot", { root: options.root }),
        })
      : renderDiffText(changes);
  process.stdout.write(output);

  if (changes.length > 0) {
    // Non-zero exit fails the CI job.
    process.exitCode = 1;
  }
}
