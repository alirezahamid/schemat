import path from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { IRSchema } from "@alirezahamid/schemat-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSql, sqlParser } from "../src/index";

const SQL = `
-- Application schema
/* Postgres enum */
CREATE TYPE user_role AS ENUM ('admin', 'member', 'guest');

CREATE TABLE public."users" (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  "name"        TEXT,
  role          user_role DEFAULT 'member',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now() -- creation time
);

CREATE TABLE posts (
  id         BIGINT PRIMARY KEY,
  author_id  INTEGER NOT NULL REFERENCES users(id),
  title      VARCHAR NOT NULL,
  body       TEXT,
  rating     NUMERIC(3,1),
  meta       JSONB
);

CREATE TABLE comments (
  id         INT PRIMARY KEY,
  post_id    INT NOT NULL,
  \`author\`   INT,
  content    TEXT NOT NULL,
  CONSTRAINT fk_post FOREIGN KEY (post_id) REFERENCES posts (id)
);
`;

describe("sql parser", () => {
  const ir = parseSql(SQL);

  it("produces valid IR that round-trips through parseSchema", () => {
    expect(() => IRSchema.parse(ir)).not.toThrow();
    expect(ir.version).toBe(1);
  });

  it("extracts all tables (quoted / schema-prefixed / plain)", () => {
    expect(ir.tables.map((t) => t.name).sort()).toEqual([
      "comments",
      "posts",
      "users",
    ]);
  });

  it("maps canonical column types", () => {
    const users = ir.tables.find((t) => t.name === "users");
    const email = users?.columns.find((c) => c.name === "email");
    expect(email?.type).toBe("string");

    const created = users?.columns.find((c) => c.name === "created_at");
    expect(created?.type).toBe("datetime");

    const posts = ir.tables.find((t) => t.name === "posts");
    expect(posts?.columns.find((c) => c.name === "id")?.type).toBe("int");
    expect(posts?.columns.find((c) => c.name === "rating")?.type).toBe("float");
    expect(posts?.columns.find((c) => c.name === "meta")?.type).toBe("json");
    expect(users?.columns.find((c) => c.name === "is_active")?.type).toBe("boolean");
  });

  it("flags primary key, unique, not-null, and defaults", () => {
    const users = ir.tables.find((t) => t.name === "users");

    const id = users?.columns.find((c) => c.name === "id");
    expect(id).toMatchObject({ isPrimaryKey: true, isUnique: true, nullable: false });

    const email = users?.columns.find((c) => c.name === "email");
    expect(email).toMatchObject({ isUnique: true, nullable: false });

    const name = users?.columns.find((c) => c.name === "name");
    expect(name?.nullable).toBe(true);

    const role = users?.columns.find((c) => c.name === "role");
    expect(role?.default).toBe("'member'");

    const active = users?.columns.find((c) => c.name === "is_active");
    expect(active?.default).toBe("true");

    const created = users?.columns.find((c) => c.name === "created_at");
    expect(created?.default).toBe("now()");
  });

  it("handles quoted / backtick identifiers", () => {
    const comments = ir.tables.find((t) => t.name === "comments");
    expect(comments?.columns.map((c) => c.name)).toContain("author");
    expect(comments?.columns.map((c) => c.name)).toContain("content");
  });

  it("extracts an inline foreign key (posts.author_id -> users.id)", () => {
    const rel = ir.relations.find(
      (r) => r.fromTable === "posts" && r.toTable === "users",
    );
    expect(rel).toMatchObject({
      name: "posts_author_id_fkey",
      fromColumns: ["author_id"],
      toColumns: ["id"],
      cardinality: "one-to-many",
    });
  });

  it("extracts a table-level foreign key (comments.post_id -> posts.id)", () => {
    const rel = ir.relations.find(
      (r) => r.fromTable === "comments" && r.toTable === "posts",
    );
    expect(rel).toMatchObject({
      name: "comments_post_id_fkey",
      fromColumns: ["post_id"],
      toColumns: ["id"],
      cardinality: "one-to-many",
    });
  });

  it("extracts the enum type", () => {
    expect(ir.enums).toEqual([
      { name: "user_role", values: ["admin", "member", "guest"] },
    ]);
  });
});

describe("sql parser detect + parse from disk", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "schemat-sql-"));
    await writeFile(path.join(dir, "schema.sql"), SQL, "utf8");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("detects a project containing schema.sql", async () => {
    expect(await sqlParser.detect(dir)).toBe(true);
  });

  it("does not detect a project without any .sql", async () => {
    expect(await sqlParser.detect(tmpdir() + "/definitely-not-here-xyz")).toBe(false);
  });

  it("parses the file into valid IR", async () => {
    const ir2 = await sqlParser.parse({ projectPath: dir });
    expect(() => IRSchema.parse(ir2)).not.toThrow();
    expect(ir2.tables).toHaveLength(3);
    expect(ir2.relations).toHaveLength(2);
    expect(ir2.enums).toHaveLength(1);
  });
});
