import path from "node:path";
import { prismaParser } from "@alirezahamid/schemat-parser-prisma";
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

  const detected = await prismaParser.detect(projectPath);
  if (!detected) {
    console.error(
      `No Prisma schema found under ${projectPath}/prisma/schema.prisma.\n` +
        "Run schemat dev from a project with a Prisma schema, or pass --root <dir>.",
    );
    process.exitCode = 1;
    return;
  }

  const schema = await prismaParser.parse({ projectPath });
  const server = await startServer(schema, options.port);

  const url = `http://localhost:${server.port}`;
  console.log(`\n  Schemat running at ${url}`);
  console.log(`  Watching ${path.relative(process.cwd(), projectPath) || "."} for changes\n`);

  const watcher = watchSchema(
    prismaParser,
    projectPath,
    (next) => {
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
