import path from "node:path";
import { normalizeParserOutput } from "@schemat/core";
import { detectParser, noSchemaMessage } from "../schema-source";
import { startServer } from "../server";
import { watchSchema } from "../watch";

export interface DevOptions {
  root: string;
  port: number;
}

/**
 * `schemat dev` — parse the project's schema, serve the interactive canvas, and
 * live-reload on schema changes.
 */
export async function runDev(options: DevOptions): Promise<void> {
  const projectPath = path.resolve(process.cwd(), options.root);

  const parser = await detectParser(projectPath);
  if (!parser) {
    console.error(await noSchemaMessage(projectPath));
    process.exitCode = 1;
    return;
  }

  const initial = normalizeParserOutput(await parser.parse({ projectPath }));
  const schema = initial.schema;
  for (const warning of initial.warnings) console.error(`Warning: ${warning}`);
  const server = await startServer(schema, options.port, projectPath);

  const url = `http://localhost:${server.port}`;
  console.log(`\n  Schemat running at ${url}`);
  console.log(`  Watching ${path.relative(process.cwd(), projectPath) || "."} for changes\n`);

  const watcher = watchSchema(
    parser,
    projectPath,
    (next, warnings) => {
      for (const warning of warnings) console.error(`Warning: ${warning}`);
      server.broadcast(next);
      console.log(
        `  ↻ schema reloaded (${next.tables.length} tables, ${next.relations.length} relations)`,
      );
    },
    (err) => console.error("  parse error:", err instanceof Error ? err.message : err),
  );

  const shutdown = async () => {
    await watcher.close();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
