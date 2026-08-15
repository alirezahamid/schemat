import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfiguredParsers, loadSchematConfig } from "../src/config";
import { clearParserCache, detectParser, listBuiltinParsers } from "../src/schema-source";

const dirs: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "schemat-cfg-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  clearParserCache();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadSchematConfig", () => {
  it("reads parsers + source from schemat.config.json", () => {
    const d = tmp();
    writeFileSync(
      join(d, "schemat.config.json"),
      JSON.stringify({ source: "sequelize", parsers: ["./p.js"] }),
    );
    expect(loadSchematConfig(d)).toEqual({
      source: "sequelize",
      parsers: ["./p.js"],
    });
  });

  it("returns {} when missing", () => {
    expect(loadSchematConfig(tmp())).toEqual({});
  });
});

describe("plugin loading", () => {
  it("loads a local parser module via config path", async () => {
    const d = tmp();
    writeFileSync(
      join(d, "fake-parser.mjs"),
      `
export default {
  name: "fake-plugin",
  async detect() { return true; },
  async parse() {
    return { version: 2, tables: [{ name: "t", columns: [], comment: null }], enums: [], relations: [] };
  },
};
`,
    );
    writeFileSync(
      join(d, "schemat.config.json"),
      JSON.stringify({ parsers: ["./fake-parser.mjs"], source: "fake-plugin" }),
    );

    const { parsers, errors } = await loadConfiguredParsers(d);
    expect(errors).toEqual([]);
    expect(parsers).toHaveLength(1);
    expect(parsers[0].name).toBe("fake-plugin");

    const detected = await detectParser(d);
    expect(detected?.name).toBe("fake-plugin");
  });
});

describe("built-ins", () => {
  it("includes sequelize", () => {
    const names = listBuiltinParsers().map((p) => p.name);
    expect(names).toContain("sequelize");
    expect(names).toContain("prisma");
  });
});
