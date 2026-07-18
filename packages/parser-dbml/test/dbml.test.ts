import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { IRSchema } from "@schemat/core";
import { afterAll, describe, expect, it } from "vitest";
import { dbmlParser } from "../src/index";

const tempDirs: string[] = [];
async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "schemat-dbml-"));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    await writeFile(path.join(dir, rel), content, "utf8");
  }
  return dir;
}

const SAMPLE = `
Table users {
  id integer [primary key]
  username varchar(255) [unique, not null, note: 'login name']
  role user_role [default: 'member']
  created_at timestamp
  Note: 'App users'
}

Table posts {
  id integer [pk]
  title varchar [not null]
  author_id integer [ref: > users.id]
  status post_status
}

Table tags {
  id integer [pk]
}

Table post_tags {
  post_id integer [ref: > posts.id]
  tag_id integer [ref: > tags.id]
}

Enum user_role {
  admin
  member
}

Enum post_status {
  draft
  published
  archived
}
`;

describe("dbml parser", () => {
  afterAll(async () => {
    await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it("detects a schema.dbml file", async () => {
    const dir = await makeProject({ "schema.dbml": SAMPLE });
    expect(await dbmlParser.detect(dir)).toBe(true);
  });

  it("detects an arbitrary *.dbml file in the root", async () => {
    const dir = await makeProject({ "mydb.dbml": SAMPLE });
    expect(await dbmlParser.detect(dir)).toBe(true);
  });

  it("does not detect a project without dbml", async () => {
    const dir = await makeProject({ "readme.md": "# nope" });
    expect(await dbmlParser.detect(dir)).toBe(false);
  });

  it("parses tables, columns and comments into valid IR", async () => {
    const dir = await makeProject({ "schema.dbml": SAMPLE });
    const ir = await dbmlParser.parse({ projectPath: dir });
    expect(() => IRSchema.parse(ir)).not.toThrow();
    expect(ir.tables.map((t) => t.name).sort()).toEqual(["post_tags", "posts", "tags", "users"]);

    const users = ir.tables.find((t) => t.name === "users");
    expect(users?.comment).toBe("App users");

    const id = users?.columns.find((c) => c.name === "id");
    expect(id).toMatchObject({ isPrimaryKey: true, nullable: false });

    const username = users?.columns.find((c) => c.name === "username");
    // type_name already carries args — no doubling.
    expect(username).toMatchObject({
      type: "varchar(255)",
      isUnique: true,
      nullable: false,
      comment: "login name",
    });

    const role = users?.columns.find((c) => c.name === "role");
    expect(role?.default).toBe("member");
  });

  it("parses enums", async () => {
    const dir = await makeProject({ "schema.dbml": SAMPLE });
    const ir = await dbmlParser.parse({ projectPath: dir });
    const byName = Object.fromEntries(ir.enums.map((e) => [e.name, e.values]));
    expect(byName.user_role).toEqual(["admin", "member"]);
    expect(byName.post_status).toEqual(["draft", "published", "archived"]);
  });

  it("extracts one-to-many relations with correct direction", async () => {
    const dir = await makeProject({ "schema.dbml": SAMPLE });
    const ir = await dbmlParser.parse({ projectPath: dir });
    const rel = ir.relations.find((r) => r.fromTable === "posts" && r.toTable === "users");
    expect(rel).toMatchObject({
      fromColumns: ["author_id"],
      toColumns: ["id"],
      cardinality: "one-to-many",
    });
    // The join-table shape yields two 1:N edges (post_tags -> posts, -> tags).
    expect(ir.relations).toHaveLength(3);
  });

  it("maps a one-to-one relation", async () => {
    const dir = await makeProject({
      "schema.dbml": `
Table users {
  id integer [pk]
}
Table profiles {
  id integer [pk]
  user_id integer [unique, ref: - users.id]
}
`,
    });
    const ir = await dbmlParser.parse({ projectPath: dir });
    const rel = ir.relations.find((r) => r.fromTable === "profiles" && r.toTable === "users");
    expect(rel?.cardinality).toBe("one-to-one");
  });
});
