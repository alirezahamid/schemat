import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { IRSchema, normalizeParserOutput } from "@schemat/core";
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
    expect(ir.tables.map((t) => t.name).sort()).toEqual(["comments", "posts", "users"]);
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
    const rel = ir.relations.find((r) => r.fromTable === "posts" && r.toTable === "users");
    expect(rel).toMatchObject({
      name: "posts_author_id_fkey",
      fromColumns: ["author_id"],
      toColumns: ["id"],
      cardinality: "one-to-many",
    });
  });

  it("extracts a table-level foreign key (comments.post_id -> posts.id)", () => {
    const rel = ir.relations.find((r) => r.fromTable === "comments" && r.toTable === "posts");
    expect(rel).toMatchObject({
      name: "comments_post_id_fkey",
      fromColumns: ["post_id"],
      toColumns: ["id"],
      cardinality: "one-to-many",
    });
  });

  it("extracts the enum type", () => {
    expect(ir.enums).toEqual([{ name: "user_role", values: ["admin", "member", "guest"] }]);
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
    expect(await sqlParser.detect(`${tmpdir()}/definitely-not-here-xyz`)).toBe(false);
  });

  it("parses the file into valid IR", async () => {
    const ir2 = normalizeParserOutput(await sqlParser.parse({ projectPath: dir })).schema;
    expect(() => IRSchema.parse(ir2)).not.toThrow();
    expect(ir2.tables).toHaveLength(3);
    expect(ir2.relations).toHaveLength(2);
    expect(ir2.enums).toHaveLength(1);
  });

  it("handles quoted table names that contain spaces", () => {
    const ir3 = parseSql('CREATE TABLE "order items" (id INT PRIMARY KEY, sku TEXT);');
    expect(() => IRSchema.parse(ir3)).not.toThrow();
    expect(ir3.tables.map((t) => t.name)).toContain("order items");
    const t = ir3.tables.find((x) => x.name === "order items");
    expect(t?.columns.map((c) => c.name).sort()).toEqual(["id", "sku"]);
    expect(t?.columns.find((c) => c.name === "id")?.isPrimaryKey).toBe(true);
  });
});

const fixturePath = (name: string) => path.join(import.meta.dirname, "fixtures", name);
const countFlags = (ir: ReturnType<typeof parseSql>) => ({
  tables: ir.tables.length,
  primaryKeyColumns: ir.tables
    .flatMap((table) => table.columns)
    .filter((column) => column.isPrimaryKey).length,
  uniqueColumns: ir.tables.flatMap((table) => table.columns).filter((column) => column.isUnique)
    .length,
  relations: ir.relations.length,
});

describe("dump fixtures", () => {
  it("parses a realistic PostgreSQL pg_dump fixture with two-pass ALTER constraints", async () => {
    const ir = parseSql(await readFile(fixturePath("postgresql-pgdump.sql"), "utf8"));

    expect(ir.tables.map((table) => table.name)).toEqual(["users", "posts", "events"]);
    expect(countFlags(ir)).toEqual({
      tables: 3,
      primaryKeyColumns: 5,
      uniqueColumns: 7,
      relations: 1,
    });
    expect(ir.relations[0]).toMatchObject({
      fromTable: "posts",
      fromColumns: ["tenant_id", "author_id"],
      toTable: "users",
      toColumns: ["tenant_id", "id"],
    });
    expect(ir.tables.flatMap((table) => table.columns).map((column) => column.name)).not.toContain(
      "missing_column",
    );
  });

  it("parses MySQL index variants without creating phantom columns", async () => {
    const ir = parseSql(await readFile(fixturePath("mysql-mysqldump.sql"), "utf8"));

    expect(countFlags(ir)).toEqual({
      tables: 2,
      primaryKeyColumns: 2,
      uniqueColumns: 4,
      relations: 1,
    });
    expect(ir.tables[0]?.columns.map((column) => column.name)).toEqual(["id", "email"]);
    expect(ir.tables[1]?.columns.map((column) => column.name)).toEqual(["id", "author_id", "slug"]);
  });
});

describe("dump-style constraints", () => {
  it("applies PostgreSQL ALTER TABLE constraints after CREATE TABLE", () => {
    const ir = parseSql(`
      CREATE TABLE public."users" (id bigint NOT NULL, email text NOT NULL);
      CREATE TABLE public.posts (id bigint NOT NULL, author_id bigint NOT NULL);
      ALTER TABLE ONLY public."users" ADD CONSTRAINT users_pkey PRIMARY KEY (id);
      ALTER TABLE public."users" ADD CONSTRAINT users_email_key UNIQUE (email);
      ALTER TABLE ONLY public.posts ADD CONSTRAINT posts_pkey PRIMARY KEY (id);
      ALTER TABLE public.posts ADD CONSTRAINT posts_author_fkey FOREIGN KEY (author_id)
        REFERENCES public."users" (id);
    `);
    const users = ir.tables.find((table) => table.name === "users");
    expect(users?.columns.find((column) => column.name === "id")).toMatchObject({
      isPrimaryKey: true,
      nullable: false,
    });
    expect(users?.columns.find((column) => column.name === "email")?.isUnique).toBe(true);
    expect(ir.relations).toContainEqual(
      expect.objectContaining({
        fromTable: "posts",
        fromColumns: ["author_id"],
        toTable: "users",
        toColumns: ["id"],
      }),
    );
  });

  it("applies ALTER constraints and REFERENCES to fully quoted qualified tables", () => {
    const ir = parseSql(`
      CREATE TABLE "app"."users" (tenant_id bigint NOT NULL, id bigint NOT NULL, email text);
      CREATE TABLE "app"."posts" (tenant_id bigint NOT NULL, id bigint NOT NULL, author_id bigint);
      ALTER TABLE ONLY "app"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (tenant_id, id);
      ALTER TABLE "app"."users" ADD CONSTRAINT "users_email_key" UNIQUE (email);
      ALTER TABLE "app"."posts" ADD CONSTRAINT "posts_author_fkey"
        FOREIGN KEY (tenant_id, author_id) REFERENCES "app"."users" (tenant_id, id);
    `);

    expect(ir.tables.map((table) => table.name)).toEqual(["users", "posts"]);
    expect(
      ir.tables[0]?.columns.filter((column) => column.isPrimaryKey).map((column) => column.name),
    ).toEqual(["tenant_id", "id"]);
    expect(ir.tables[0]?.columns.find((column) => column.name === "email")?.isUnique).toBe(true);
    expect(ir.relations).toContainEqual(
      expect.objectContaining({
        fromTable: "posts",
        fromColumns: ["tenant_id", "author_id"],
        toTable: "users",
        toColumns: ["tenant_id", "id"],
      }),
    );
  });

  it("does not emit MySQL inline KEY or INDEX entries as columns", () => {
    const ir = parseSql(`CREATE TABLE posts (
      id bigint NOT NULL, author_id bigint NOT NULL,
      PRIMARY KEY (id), KEY idx_author (author_id), INDEX idx_id (id)
    );`);
    expect(ir.tables[0]?.columns.map((column) => column.name)).toEqual(["id", "author_id"]);
  });
});

describe("`key` / `index` as column names (B1 regression)", () => {
  // `key` and `index` are UNRESERVED keywords in PostgreSQL and are legal column
  // names. Detection of MySQL inline indexes must be shape-aware, not
  // first-token-aware, or these real columns are silently dropped.

  it("keeps a PostgreSQL column named `key` with its type and flags", () => {
    const ir = parseSql(`CREATE TABLE digests (
      id uuid NOT NULL,
      key text NOT NULL,
      time_zone text NOT NULL
    );`);
    const digests = ir.tables.find((table) => table.name === "digests");
    expect(digests?.columns.map((column) => column.name)).toEqual(["id", "key", "time_zone"]);
    expect(digests?.columns.find((column) => column.name === "key")).toMatchObject({
      type: "string",
      nullable: false,
    });
  });

  it("keeps a `key` column declared with a parameterised type", () => {
    const ir = parseSql(`CREATE TABLE tutorials (
      id uuid NOT NULL,
      key character varying(255) NOT NULL,
      current_step integer DEFAULT 1 NOT NULL
    );`);
    const tutorials = ir.tables.find((table) => table.name === "tutorials");
    expect(tutorials?.columns.map((column) => column.name)).toEqual(["id", "key", "current_step"]);
    expect(tutorials?.columns.find((column) => column.name === "key")).toMatchObject({
      type: "string",
      nullable: false,
    });
  });

  it("keeps a PostgreSQL column named `index` with its type and flags", () => {
    const ir = parseSql(`CREATE TABLE steps (
      id uuid NOT NULL,
      index integer DEFAULT 0 NOT NULL,
      label text
    );`);
    const steps = ir.tables.find((table) => table.name === "steps");
    expect(steps?.columns.map((column) => column.name)).toEqual(["id", "index", "label"]);
    expect(steps?.columns.find((column) => column.name === "index")).toMatchObject({
      type: "int",
      nullable: false,
    });
    expect(steps?.columns.find((column) => column.name === "label")?.nullable).toBe(true);
  });

  it("keeps the relation from a `key` column carrying an inline REFERENCES", () => {
    const ir = parseSql(`CREATE TABLE digests (id uuid NOT NULL PRIMARY KEY);
      CREATE TABLE locators (
        id uuid NOT NULL,
        key text NOT NULL REFERENCES digests (id)
      );`);
    const locators = ir.tables.find((table) => table.name === "locators");
    expect(locators?.columns.map((column) => column.name)).toEqual(["id", "key"]);
    expect(ir.relations).toContainEqual(
      expect.objectContaining({
        fromTable: "locators",
        fromColumns: ["key"],
        toTable: "digests",
        toColumns: ["id"],
      }),
    );
  });

  it("still treats every MySQL index variant as an index, with no phantom columns", () => {
    const ir = parseSql(`CREATE TABLE \`posts\` (
      \`id\` bigint NOT NULL,
      \`email\` varchar(255) NOT NULL,
      \`author_id\` bigint NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`posts_email_key\` (\`email\`),
      KEY \`idx_author\` (\`author_id\`),
      INDEX \`idx_id\` (\`id\`),
      FULLTEXT KEY \`posts_email_fulltext\` (\`email\`),
      SPATIAL INDEX \`posts_spatial\` (\`id\`),
      KEY \`idx_using\` USING BTREE (\`author_id\`),
      KEY (\`email\`)
    );`);
    const posts = ir.tables.find((table) => table.name === "posts");
    expect(posts?.columns.map((column) => column.name)).toEqual(["id", "email", "author_id"]);
    expect(posts?.columns.find((column) => column.name === "email")?.isUnique).toBe(true);
    expect(posts?.columns.find((column) => column.name === "id")?.isPrimaryKey).toBe(true);
  });

  it("parses a dump fixture where `key` and `index` are real columns", async () => {
    const ir = parseSql(await readFile(fixturePath("postgresql-key-columns.sql"), "utf8"));

    expect(ir.tables.map((table) => table.name)).toEqual(["digests", "tutorials", "post_locators"]);

    const digests = ir.tables.find((table) => table.name === "digests");
    expect(digests?.columns.find((column) => column.name === "key")).toMatchObject({
      type: "string",
      nullable: false,
    });

    const tutorials = ir.tables.find((table) => table.name === "tutorials");
    expect(tutorials?.columns.find((column) => column.name === "key")).toMatchObject({
      type: "string",
      nullable: false,
    });

    const locators = ir.tables.find((table) => table.name === "post_locators");
    expect(locators?.columns.map((column) => column.name)).toEqual([
      "id",
      "post_id",
      "key",
      "index",
      "scope",
    ]);
    expect(locators?.columns.find((column) => column.name === "index")).toMatchObject({
      type: "int",
      nullable: false,
    });
    // ALTER ... UNIQUE (key, index) must resolve against those real columns.
    expect(locators?.columns.find((column) => column.name === "key")?.isUnique).toBe(true);
    expect(locators?.columns.find((column) => column.name === "index")?.isUnique).toBe(true);
    // The inline REFERENCES on the `key` column must survive.
    expect(ir.relations).toContainEqual(
      expect.objectContaining({
        fromTable: "post_locators",
        fromColumns: ["key"],
        toTable: "digests",
      }),
    );
  });

  it("warns for CHECK constraints and genuinely unsupported statements", async () => {
    const d = await mkdtemp(path.join(tmpdir(), "sql-warning-"));
    const file = path.join(d, "schema.sql");
    await writeFile(
      file,
      "CREATE TABLE users (id INT, CHECK (id > 0)); LOCK TABLE users IN ACCESS EXCLUSIVE MODE;",
    );
    try {
      const result = await sqlParser.parse({ projectPath: d, files: [file] });
      expect("schema" in result ? result.warnings : []).toEqual([
        'SQL CHECK constraint on table "users" is not represented; constraint skipped.',
        'Unsupported SQL statement "LOCK TABLE users IN ACCESS EXCLUSIVE MODE"; statement skipped.',
      ]);
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });
});

describe("CREATE UNIQUE INDEX", () => {
  const parseIndexes = (indexes: string) => {
    const warnings: string[] = [];
    const schema = parseSql(`CREATE TABLE users (email TEXT, tenant_id INT); ${indexes}`, warnings);
    return { schema, warnings };
  };

  it("marks a single indexed column unique", () => {
    const { schema, warnings } = parseIndexes(
      "CREATE UNIQUE INDEX users_email_idx ON users (email);",
    );
    expect(schema.tables[0]?.columns[0]?.isUnique).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("handles modifiers and quoted schema-qualified identifiers", () => {
    const warnings: string[] = [];
    const schema = parseSql(
      'CREATE TABLE "app"."users" ("email" TEXT); CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "users_email_idx" ON "app"."users" USING btree ("email");',
      warnings,
    );
    expect(schema.tables[0]?.columns[0]?.isUnique).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("ignores composite and partial unique indexes without warning", () => {
    const { schema, warnings } = parseIndexes(
      "CREATE UNIQUE INDEX composite_idx ON users (email, tenant_id); CREATE UNIQUE INDEX partial_idx ON users (email) WHERE tenant_id = 1;",
    );
    expect(schema.tables[0]?.columns.map((column) => column.isUnique)).toEqual([false, false]);
    expect(warnings).toEqual([]);
  });

  it("keeps plain indexes silent and does not change uniqueness", () => {
    const { schema, warnings } = parseIndexes("CREATE INDEX users_email_idx ON users (email);");
    expect(schema.tables[0]?.columns[0]?.isUnique).toBe(false);
    expect(warnings).toEqual([]);
  });
});

describe("unmatched-statement noise control (B2)", () => {
  it("does not warn for ordinary pg_dump plumbing", () => {
    const warnings: string[] = [];
    parseSql(
      [
        "SET statement_timeout = 0;",
        "SELECT pg_catalog.set_config('search_path', '', false);",
        "CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;",
        "COMMENT ON EXTENSION citext IS 'case-insensitive strings';",
        "CREATE SCHEMA public;",
        "CREATE SEQUENCE users_id_seq;",
        "CREATE VIEW active_users AS SELECT * FROM users;",
        "CREATE UNIQUE INDEX users_email_index ON public.users USING btree (email);",
        "CREATE TRIGGER t BEFORE INSERT ON public.users FOR EACH ROW EXECUTE PROCEDURE f();",
        "ALTER TABLE public.users OWNER TO postgres;",
        "ALTER FUNCTION public.f() OWNER TO postgres;",
        "GRANT ALL ON SCHEMA public TO postgres;",
        "REVOKE ALL ON SCHEMA public FROM PUBLIC;",
        "INSERT INTO public.schema_migrations (version) VALUES (1);",
        "CREATE TABLE users (id INT PRIMARY KEY, email TEXT);",
      ].join("\n"),
      warnings,
    );
    expect(warnings).toEqual([]);
  });

  it("treats a dollar-quoted body as one statement, not fragments", () => {
    const warnings: string[] = [];
    const ir = parseSql(
      [
        "CREATE FUNCTION bump() RETURNS trigger LANGUAGE plpgsql AS $$",
        "BEGIN",
        "  NEW.updated_at = now();",
        "  RETURN NEW;",
        "END",
        "$$;",
        "CREATE TABLE posts (id INT PRIMARY KEY);",
      ].join("\n"),
      warnings,
    );
    expect(warnings).toEqual([]);
    expect(ir.tables.map((t) => t.name)).toEqual(["posts"]);
  });

  it("warns when a $$ quote is unterminated", () => {
    const warnings: string[] = [];
    parseSql("CREATE FUNCTION broken() RETURNS void AS $$\nBEGIN;", warnings);
    expect(warnings).toEqual([
      'Unterminated SQL dollar quote "$$" opened at line 1; input from that point on could not be parsed.',
    ]);
  });

  it("warns when a tagged dollar quote is unterminated", () => {
    const warnings: string[] = [];
    parseSql("\nCREATE FUNCTION broken() RETURNS void AS $func$\nBEGIN;", warnings);
    expect(warnings).toEqual([
      'Unterminated SQL dollar quote "$func$" opened at line 2; input from that point on could not be parsed.',
    ]);
  });

  it("aggregates repeated unsupported statements instead of one warning each", () => {
    const warnings: string[] = [];
    parseSql(
      [
        "LOCK TABLE a IN ACCESS EXCLUSIVE MODE;",
        "LOCK TABLE b IN ACCESS EXCLUSIVE MODE;",
        "LOCK TABLE c IN ACCESS EXCLUSIVE MODE;",
      ].join("\n"),
      warnings,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("3 LOCK statements skipped");
    // Examples are capped, so the third statement is not echoed.
    expect(warnings[0]).not.toContain("LOCK TABLE c");
  });
});
