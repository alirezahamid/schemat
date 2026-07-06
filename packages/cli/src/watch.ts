import path from "node:path";
import type { IRSchema, SchemaParser } from "@alirezahamid/schemat-core";
import chokidar, { type FSWatcher } from "chokidar";

/**
 * Watch a project's schema source and invoke `onChange` with a freshly parsed
 * IR whenever it changes. Debounced so a burst of filesystem events triggers a
 * single re-parse. Returns the watcher so the caller can close it.
 */
export function watchSchema(
  parser: SchemaParser,
  projectPath: string,
  onChange: (schema: IRSchema) => void,
  onError: (err: unknown) => void,
): FSWatcher {
  // For the Prisma parser, watch the schema directory.
  const watchTarget = path.join(projectPath, "prisma");

  const watcher = chokidar.watch(watchTarget, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 30 },
  });

  let timer: NodeJS.Timeout | null = null;
  const reparse = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const schema = await parser.parse({ projectPath });
        onChange(schema);
      } catch (err) {
        onError(err);
      }
    }, 100);
  };

  watcher.on("add", reparse).on("change", reparse).on("unlink", reparse);
  return watcher;
}
