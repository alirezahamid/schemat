import path from "node:path";
import type { IRSchema, SchemaParser } from "@schemat/core";
import chokidar from "chokidar";

/** A watcher handle that fully tears down timers and in-flight work. */
export interface SchemaWatcher {
  close(): Promise<void>;
}

/**
 * Watch a project's schema source and invoke `onChange` with a freshly parsed
 * IR whenever it changes. Debounced so a burst of filesystem events triggers a
 * single re-parse. Concurrent parses are single-flighted by an incrementing id
 * so a slow older parse can never clobber a newer result. All timers and
 * in-flight callbacks are suppressed once `close()` is called.
 */
export function watchSchema(
  parser: SchemaParser,
  projectPath: string,
  onChange: (schema: IRSchema) => void,
  onError: (err: unknown) => void,
): SchemaWatcher {
  // For the Prisma parser, watch the schema directory.
  const watchTarget = path.join(projectPath, "prisma");

  const watcher = chokidar.watch(watchTarget, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 30 },
  });

  let timer: NodeJS.Timeout | null = null;
  let latestParseId = 0;
  let disposed = false;

  const reparse = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const parseId = ++latestParseId;
      parser
        .parse({ projectPath })
        .then((schema) => {
          // Drop stale results: only the most recently started parse wins.
          if (disposed || parseId !== latestParseId) return;
          onChange(schema);
        })
        .catch((err) => {
          if (disposed || parseId !== latestParseId) return;
          onError(err);
        });
    }, 100);
  };

  watcher.on("add", reparse).on("change", reparse).on("unlink", reparse);

  return {
    async close() {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await watcher.close();
    },
  };
}
