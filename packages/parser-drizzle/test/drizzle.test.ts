import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { IRSchema } from "@schemat/core";
import { drizzleParser } from "../src/index";

// Track temp dirs for cleanup.
const dirs: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drizzle-parser-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    const slash = full.lastIndexOf("/");
    if (slash > dir.length) await mkdir(full.slice(0, slash), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

// ---------------------------------------------------------------------------

const PG_SCHEMA = `
import { pgTable, pgEnum, serial, varchar, integer, timestamp, boolean } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'user', 'guest']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 120 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  active: boolean('active').default(true),
});

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 200 }).notNull(),
  authorId: integer('author_id').references(() => users.id),
});

// One-to-one: the FK column is itself unique.
export const profiles = pgTable('profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).unique(),
  bio: varchar('bio', { length: 500 }),
});
`;

describe("drizzleParser", () => {
  it("detects a project with a conventional schema file", async () => {
    const dir = await makeProject({ "src/schema.ts": PG_SCHEMA });
    expect(await drizzleParser.detect(dir)).toBe(true);
  });

  it("detects via drizzle.config.ts when a schema file is also present", async () => {
    const dir = await makeProject({
      "drizzle.config.ts": `export default { schema: './src/schema.ts' };`,
      "src/schema.ts": PG_SCHEMA,
    });
    expect(await drizzleParser.detect(dir)).toBe(true);
  });

  it("does not hijack an unrelated schema.ts that isn't Drizzle (e.g. Zod)", async () => {
    const dir = await makeProject({
      "src/schema.ts": `
        import { z } from 'zod';
        export const userSchema = z.object({ id: z.number(), name: z.string() });
      `,
    });
    // No drizzle-orm import and no *Table() call -> must NOT detect.
    expect(await drizzleParser.detect(dir)).toBe(false);
  });

  it("detects via drizzle-orm dependency + schema file", async () => {
    const dir = await makeProject({
      "package.json": JSON.stringify({ dependencies: { "drizzle-orm": "^0.30.0" } }),
      "db/schema.ts": PG_SCHEMA,
    });
    expect(await drizzleParser.detect(dir)).toBe(true);
  });

  it("does not detect an unrelated project", async () => {
    const dir = await makeProject({
      "package.json": JSON.stringify({ dependencies: { express: "^4" } }),
      "src/app.ts": `console.log('hi');`,
    });
    expect(await drizzleParser.detect(dir)).toBe(false);
  });

  it("parses tables, columns, enums and relations from a pg schema", async () => {
    const dir = await makeProject({ "src/schema.ts": PG_SCHEMA });
    const ir: IRSchema = await drizzleParser.parse({ projectPath: dir });

    expect(ir.version).toBe(1);

    // --- tables ---
    const tableNames = ir.tables.map((t) => t.name).sort();
    expect(tableNames).toEqual(["posts", "profiles", "users"]);

    const users = ir.tables.find((t) => t.name === "users");
    expect(users.comment).toBeNull();

    const id = users.columns.find((c) => c.name === "id");
    expect(id.type).toBe("serial");
    expect(id.isPrimaryKey).toBe(true);
    expect(id.nullable).toBe(false); // pk is implicitly not-null

    const email = users.columns.find((c) => c.name === "email");
    expect(email.type).toBe("varchar");
    expect(email.isUnique).toBe(true);
    expect(email.nullable).toBe(false); // .notNull()

    const name = users.columns.find((c) => c.name === "name");
    expect(name.nullable).toBe(true); // no .notNull()
    expect(name.isUnique).toBe(false);

    const active = users.columns.find((c) => c.name === "active");
    expect(active.type).toBe("boolean");
    expect(active.default).toBe("true");

    const createdAt = users.columns.find((c) => c.name === "created_at");
    expect(createdAt.default).toBe("now()"); // .defaultNow()
    expect(createdAt.nullable).toBe(false);

    // --- column db-name from first string arg, not JS key ---
    const authorId = ir.tables
      .find((t) => t.name === "posts")
      .columns.find((c) => c.name === "author_id");
    expect(authorId.type).toBe("integer");

    // --- enums ---
    expect(ir.enums).toHaveLength(1);
    expect(ir.enums[0]).toEqual({ name: "role", values: ["admin", "user", "guest"] });

    // --- relations ---
    // posts.author_id -> users.id : one-to-many (owning col not unique)
    const postRel = ir.relations.find((r) => r.fromTable === "posts");
    expect(postRel.fromColumns).toEqual(["author_id"]);
    expect(postRel.toTable).toBe("users");
    expect(postRel.toColumns).toEqual(["id"]);
    expect(postRel.cardinality).toBe("one-to-many");

    // profiles.user_id -> users.id : one-to-one (owning col is unique)
    const profRel = ir.relations.find((r) => r.fromTable === "profiles");
    expect(profRel.fromColumns).toEqual(["user_id"]);
    expect(profRel.toTable).toBe("users");
    expect(profRel.toColumns).toEqual(["id"]);
    expect(profRel.cardinality).toBe("one-to-one");

    expect(ir.relations).toHaveLength(2);
  });

  it("defaults a column name to its property key when the name arg is omitted", async () => {
    const schema = `
      import { pgTable, serial, text } from 'drizzle-orm/pg-core';
      export const notes = pgTable('notes', {
        id: serial().primaryKey(),
        body: text(),
      });
    `;
    const dir = await makeProject({ "src/schema.ts": schema });
    const ir = await drizzleParser.parse({ projectPath: dir });
    const notes = ir.tables.find((t) => t.name === "notes");
    expect(notes.columns.map((c) => c.name).sort()).toEqual(["body", "id"]);
    expect(notes.columns.find((c) => c.name === "id")?.isPrimaryKey).toBe(true);
  });

  it("parses mysqlTable and sqliteTable builders", async () => {
    const schema = `
      import { mysqlTable, int, varchar } from 'drizzle-orm/mysql-core';
      import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
      export const a = mysqlTable('a', { id: int('id').primaryKey() });
      export const b = sqliteTable('b', { id: integer('id').primaryKey(), label: text('label') });
    `;
    const dir = await makeProject({ "src/schema.ts": schema });
    const ir = await drizzleParser.parse({ projectPath: dir });
    expect(ir.tables.map((t) => t.name).sort()).toEqual(["a", "b"]);
    expect(ir.tables.find((t) => t.name === "a")?.columns[0].type).toBe("int");
  });

  it("respects input.files when provided", async () => {
    const dir = await makeProject({
      "weird/place.ts": `
        import { pgTable, serial } from 'drizzle-orm/pg-core';
        export const t = pgTable('t', { id: serial('id').primaryKey() });
      `,
      // A decoy conventional file that should be ignored when files is set.
      "src/schema.ts": PG_SCHEMA,
    });
    const ir = await drizzleParser.parse({ projectPath: dir, files: ["weird/place.ts"] });
    expect(ir.tables.map((t) => t.name)).toEqual(["t"]);
  });

  it("returns an empty-but-valid IR for an empty schema file", async () => {
    const dir = await makeProject({ "src/schema.ts": "" });
    const ir = await drizzleParser.parse({ projectPath: dir });
    expect(ir).toEqual({ version: 1, tables: [], enums: [], relations: [] });
  });

  it("does not throw on a malformed schema file and salvages valid tables", async () => {
    // Unterminated object / dangling call — syntactically broken.
    const schema = `
      import { pgTable, serial, varchar } from 'drizzle-orm/pg-core';
      export const ok = pgTable('ok', { id: serial('id').primaryKey() });
      export const broken = pgTable('broken', { id: serial('id').primaryKey(
    `;
    const dir = await makeProject({ "src/schema.ts": schema });
    const ir = await drizzleParser.parse({ projectPath: dir });
    // Must not throw; the valid table is recovered.
    expect(ir.tables.some((t) => t.name === "ok")).toBe(true);
    expect(ir.version).toBe(1);
  });
});
