import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
);

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  splitting: false,
  // Inline the package version at build time so `schemat --version` stays in
  // sync with what's published, without a runtime require() of package.json
  // (which breaks once the file is bundled into dist/).
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
});
