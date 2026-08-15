import path from "node:path";
import { normalizeParserOutput } from "@schemat/core";
import { noSchemaMessage, resolveParser } from "../schema-source";
import { startServer } from "../server";
import { suggestCommand } from "../suggest";
import { watchSchema } from "../watch";

export interface DevOptions {
  root: string;
  port: number;
  source?: string;
}

/**
 * `schemat dev` — parse the project's schema, serve the interactive canvas, and
 * live-reload on schema changes.
 */
export async function runDev(options: DevOptions): Promise<void> {
  const projectPath = path.resolve(process.cwd(), options.root);

  const parser = await resolveParser(projectPath, options.source);
  if (!parser) {
    console.error(await noSchemaMessage(projectPath, { command: "dev", root: options.root }));
    process.exitCode = 1;
    return;
  }

  const initial = normalizeParserOutput(await parser.parse({ projectPath }));
  const schema = initial.schema;
  for (const warning of initial.warnings) console.error(`Warning: ${warning}`);

  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer(schema, options.port, projectPath);
  } catch (err) {
    // A busy port is normal user error, not a crash: print something actionable
    // instead of a raw stack trace. Anything else still propagates.
    if ((err as NodeJS.ErrnoException)?.code !== "EADDRINUSE") throw err;
    const retry = suggestCommand("dev", {
      root: options.root,
      extra: ["--port", String(options.port + 1)],
    });
    console.error(
      `Port ${options.port} is already in use.\n` +
        `Pick another port, e.g.:\n  ${retry}\n` +
        `Or let the OS choose a free one:\n  ${suggestCommand("dev", { root: options.root, extra: ["--port", "0"] })}`,
    );
    process.exitCode = 1;
    return;
  }

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
