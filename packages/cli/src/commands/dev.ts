import path from "node:path";
import { normalizeParserOutput } from "@schemat/core";
import { ensureProjectDir } from "../project-path";
import { noSchemaMessage, resolveParser } from "../schema-source";
import { startServer } from "../server";
import { suggestCommand } from "../suggest";
import { watchSchema } from "../watch";

export interface DevOptions {
  root: string;
  /** Raw `--port` value: validated here so bad input gets a real message. */
  port: string | number;
  source?: string;
}

/** Highest port a TCP socket can bind. `--port 0` means "OS picks one". */
const MAX_PORT = 65535;

/**
 * Validate `--port` ourselves. Node's own message for a bad port is
 * `options.port should be >= 0 and < 65536. Received type number (NaN).`,
 * which never mentions schemat or the flag the user typed.
 */
function parsePort(value: string | number): number | null {
  const port = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) return null;
  return port;
}

/**
 * `schemat dev` — parse the project's schema, serve the interactive canvas, and
 * live-reload on schema changes.
 */
export async function runDev(options: DevOptions): Promise<void> {
  const port = parsePort(options.port);
  if (port === null) {
    console.error(
      `Invalid --port "${options.port}". Pass a whole number between 0 and ${MAX_PORT}, or use \`${suggestCommand(
        "dev",
        { root: options.root, extra: ["--port", "0"] },
      )}\` to let the OS pick a free port.`,
    );
    process.exitCode = 1;
    return;
  }

  const projectPath = path.resolve(process.cwd(), options.root);
  if (!(await ensureProjectDir(projectPath, { command: "dev", root: options.root }))) return;

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
    server = await startServer(schema, port, projectPath);
  } catch (err) {
    // A busy port is normal user error, not a crash: print something actionable
    // instead of a raw stack trace. Anything else still propagates.
    if ((err as NodeJS.ErrnoException)?.code !== "EADDRINUSE") throw err;
    const anyPort = suggestCommand("dev", { root: options.root, extra: ["--port", "0"] });
    // At the top of the range there is no "next port" to suggest — +1 would be
    // 65536, which the CLI itself rejects.
    const retry =
      port < MAX_PORT
        ? `Pick another port, e.g.:\n  ${suggestCommand("dev", {
            root: options.root,
            extra: ["--port", String(port + 1)],
          })}\n`
        : "";
    console.error(
      `Port ${port} is already in use.\n${retry}Or let the OS choose a free one:\n  ${anyPort}`,
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
