import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { detectParser, getParserByName, resolveParser } from "../src/schema-source";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "schemat-source-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("source override + config", () => {
  it("lists known parsers", () => {
    expect(getParserByName("prisma")?.name).toBe("prisma");
    expect(getParserByName("drizzle")?.name).toBe("drizzle");
    expect(getParserByName("sql")?.name).toBe("sql");
    expect(getParserByName("nope")).toBeUndefined();
  });

  it("CLI --source override beats config file", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, "schemat.config.json"),
        JSON.stringify({ source: "sql" }),
        "utf8",
      );
      const parser = await resolveParser(dir, "prisma");
      expect(parser?.name).toBe("prisma");
    });
  });

  it("config source beats auto-detect", async () => {
    await withTempDir(async (dir) => {
      await mkdir(path.join(dir, "prisma"), { recursive: true });
      await writeFile(
        path.join(dir, "prisma", "schema.prisma"),
        `datasource db { provider = "sqlite" url = "file:./dev.db" }\ngenerator client { provider = "prisma-client-js" }\nmodel User { id Int @id }`,
        "utf8",
      );
      await writeFile(
        path.join(dir, "schemat.config.json"),
        JSON.stringify({ source: "sql" }),
        "utf8",
      );
      const auto = await detectParser(dir);
      expect(auto?.name).toBe("prisma");
      const forced = await resolveParser(dir);
      expect(forced?.name).toBe("sql");
    });
  });

  it("loads .schematrc.json when schemat.config.json is absent", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, ".schematrc.json"),
        JSON.stringify({ source: "dbml" }),
        "utf8",
      );
      const cfg = await loadConfig(dir);
      expect(cfg).toEqual({ source: "dbml" });
    });
  });

  it("prefers schemat.config.json over .schematrc.json", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, "schemat.config.json"),
        JSON.stringify({ source: "prisma" }),
        "utf8",
      );
      await writeFile(path.join(dir, ".schematrc.json"), JSON.stringify({ source: "sql" }), "utf8");
      const cfg = await loadConfig(dir);
      expect(cfg).toEqual({ source: "prisma" });
    });
  });

  it("auto-detect prefers drizzle over a stray seed.sql", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ dependencies: { "drizzle-orm": "0.30.0" } }),
        "utf8",
      );
      await mkdir(path.join(dir, "src"), { recursive: true });
      await writeFile(
        path.join(dir, "src", "schema.ts"),
        `import { pgTable, serial, text } from "drizzle-orm/pg-core";\nexport const users = pgTable("users", { id: serial("id").primaryKey(), name: text("name") });\n`,
        "utf8",
      );
      await writeFile(
        path.join(dir, "seed.sql"),
        "INSERT INTO users (name) VALUES ('alice');\n",
        "utf8",
      );
      const parser = await detectParser(dir);
      expect(parser?.name).toBe("drizzle");
    });
  });
});
