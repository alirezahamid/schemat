import path from "node:path";
import { noSchemaMessage, resolveSchemaResult } from "../schema-source";
import { saveSnapshot, snapshotPath } from "../snapshot";

export interface SnapshotOptions {
  root: string;
  source?: string;
}

/**
 * `schemat snapshot` — parse the project's schema and write it to
 * `.schemat/schema.snapshot.json`. Commit that file; `schemat check` compares
 * the live schema against it to detect documentation drift in CI.
 */
export async function runSnapshot(options: SnapshotOptions): Promise<void> {
  const projectPath = path.resolve(process.cwd(), options.root);

  const result = await resolveSchemaResult(projectPath, options.source);
  const schema = result?.schema ?? null;
  for (const warning of result?.warnings ?? []) console.error(`Warning: ${warning}`);
  if (!schema) {
    console.error(await noSchemaMessage(projectPath));
    process.exitCode = 1;
    return;
  }

  await saveSnapshot(projectPath, schema);
  const rel = path.relative(process.cwd(), snapshotPath(projectPath)) || snapshotPath(projectPath);
  console.log(
    `  ✓ Snapshot written: ${schema.tables.length} tables, ${schema.relations.length} relations, ` +
      `${schema.enums.length} enums → ${rel}`,
  );
  console.log("    Commit this file so `schemat check` can detect drift in CI.");
}
