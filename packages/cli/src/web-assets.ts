import { createRequire } from "node:module";
import path from "node:path";

/**
 * Resolve the built web assets directory shipped by @alirezahamid/schemat-web.
 * We resolve the package's package.json and walk to its dist folder so this
 * works both in the monorepo and when installed from npm.
 */
export function resolveWebDist(): string {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve("@alirezahamid/schemat-web/package.json");
  return path.join(path.dirname(pkgJson), "dist");
}
