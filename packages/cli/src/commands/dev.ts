import path from "node:path";
import { normalizeParserOutput } from "@schemat/core";
import { ensureProjectDir } from "../project-path";
import { noSchemaMessage, resolveParser } from "../schema-source";
import { startServer } from "../server";
import { suggestCommand } from "../suggest";
import { arrow, detail, errorBlock, heading, info, paint, symbol, warning } from "../ui";
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
    errorBlock(
      `Invalid --port "${options.port}".`,
      `Pass a whole number between 0 and ${MAX_PORT}, or let the OS pick a free port:`,
      [suggestCommand("dev", { root: options.root, extra: ["--port", "0"] })],
    );
    process.exitCode = 1;
    return;
  }

  const projectPath = path.resolve(process.cwd(), options.root);
  if (!(await ensureProjectDir(projectPath, { command: "dev", root: options.root }))) return;

  const parser = await resolveParser(projectPath, options.source);
  if (!parser) {
    errorBlock(await noSchemaMessage(projectPath, { command: "dev", root: options.root }));
    process.exitCode = 1;
    return;
  }

  const initial = normalizeParserOutput(await parser.parse({ projectPath }));
  const schema = initial.schema;
  for (const text of initial.warnings) warning(text);

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
        ? [suggestCommand("dev", { root: options.root, extra: ["--port", String(port + 1)] })]
        : [];
    errorBlock(
      `Port ${port} is already in use.`,
      "Pick another port, or let the OS choose a free one:",
      [...retry, anyPort],
    );
    process.exitCode = 1;
    return;
  }

  const url = `http://localhost:${server.port}`;
  const watched = path.relative(process.cwd(), projectPath) || ".";
  // Calm banner: the URL is the one thing worth finding at a glance.
  process.stdout.write(`\n  ${heading("Schemat")}  ${paint(process.stdout, "info", url)}\n`);
  detail(`watching ${watched} ${arrow()} live reload on schema changes`);
  process.stdout.write("\n");

  const watcher = watchSchema(
    parser,
    projectPath,
    (next, warnings) => {
      for (const text of warnings) warning(text);
      server.broadcast(next);
      // One quiet line per successful rebuild — no per-file spam.
      info(
        `${symbol("reload")} reloaded ${arrow()} ${next.tables.length} tables, ${next.relations.length} relations`,
      );
    },
    (err) => errorBlock("Schema parse failed", err instanceof Error ? err.message : String(err)),
  );

  const shutdown = async () => {
    await watcher.close();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
