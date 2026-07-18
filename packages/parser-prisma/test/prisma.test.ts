import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IRSchema } from "@schemat/core";
import { afterAll, describe, expect, it } from "vitest";
import { prismaParser } from "../src/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleProject = path.resolve(here, "../../../examples/blog");

// Track temp dirs to clean up after the suite.
const tempDirs: string[] = [];
async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "schemat-prisma-"));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}

describe("prisma parser", () => {
  it("detects a prisma project", async () => {
    expect(await prismaParser.detect(exampleProject)).toBe(true);
  });

  it("does not detect a non-prisma project", async () => {
    expect(await prismaParser.detect("/tmp")).toBe(false);
  });

  it("parses the example schema into valid IR", async () => {
    const ir = await prismaParser.parse({ projectPath: exampleProject });
    expect(() => IRSchema.parse(ir)).not.toThrow();
    expect(ir.tables.map((t) => t.name).sort()).toEqual(["Post", "Profile", "Tag", "User"]);
    expect(ir.enums.map((e) => e.name).sort()).toEqual(["PostStatus", "Role"]);
  });

  it("maps columns with types, pk, nullability, defaults, comments", async () => {
    const ir = await prismaParser.parse({ projectPath: exampleProject });
    const user = ir.tables.find((t) => t.name === "User");
    expect(user?.comment).toBe("An application user.");

    const id = user?.columns.find((c) => c.name === "id");
    expect(id).toMatchObject({ type: "Int", isPrimaryKey: true, nullable: false });
    expect(id?.default).toBe("autoincrement()");

    const name = user?.columns.find((c) => c.name === "name");
    expect(name?.nullable).toBe(true);

    const email = user?.columns.find((c) => c.name === "email");
    expect(email?.isUnique).toBe(true);

    // Relation fields must NOT appear as columns.
    expect(user?.columns.find((c) => c.name === "posts")).toBeUndefined();
  });

  it("extracts a one-to-many relation (Post.author -> User)", async () => {
    const ir = await prismaParser.parse({ projectPath: exampleProject });
    const rel = ir.relations.find((r) => r.fromTable === "Post" && r.toTable === "User");
    expect(rel).toMatchObject({
      fromColumns: ["authorId"],
      toColumns: ["id"],
      cardinality: "one-to-many",
    });
  });

  it("extracts a one-to-one relation (Profile.user -> User)", async () => {
    const ir = await prismaParser.parse({ projectPath: exampleProject });
    const rel = ir.relations.find((r) => r.fromTable === "Profile" && r.toTable === "User");
    expect(rel?.cardinality).toBe("one-to-one");
  });

  it("extracts the Post<->Tag many-to-many exactly once", async () => {
    const ir = await prismaParser.parse({ projectPath: exampleProject });
    const m2m = ir.relations.filter((r) => r.cardinality === "many-to-many");
    expect(m2m).toHaveLength(1);
    const names = [m2m[0]?.fromTable, m2m[0]?.toTable].sort();
    expect(names).toEqual(["Post", "Tag"]);
  });
});

// Real-world robustness: schemas that fail `prisma generate`-style validation
// but that Schemat must still render, because it only reads structure and never
// connects to a database. Each case is a shape found in real public repos.
describe("prisma parser — real-world schema shapes", () => {
  afterAll(async () => {
    await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it("parses a datasource with NO url (formbricks / umami shape)", async () => {
    const dir = await makeProject({
      "prisma/schema.prisma": `
generator client {
  provider        = "prisma-client"
  previewFeatures = ["postgresqlExtensions"]
}
datasource db {
  provider   = "postgresql"
  extensions = [pgvector(map: "vector")]
}
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
}
`,
    });
    const ir = await prismaParser.parse({ projectPath: dir });
    expect(() => IRSchema.parse(ir)).not.toThrow();
    expect(ir.tables.map((t) => t.name)).toEqual(["User"]);
  });

  it("parses a datasource with only directUrl, no url", async () => {
    const dir = await makeProject({
      "prisma/schema.prisma": `
datasource db {
  provider  = "postgresql"
  directUrl = env("DIRECT_URL")
}
model Account {
  id Int @id @default(autoincrement())
}
`,
    });
    const ir = await prismaParser.parse({ projectPath: dir });
    expect(ir.tables.map((t) => t.name)).toEqual(["Account"]);
  });

  it("detects and parses a multi-file prisma/schema/ folder (prismaSchemaFolder)", async () => {
    const dir = await makeProject({
      "prisma/schema/base.prisma": `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
generator client {
  provider = "prisma-client-js"
}
`,
      "prisma/schema/user.prisma": `
model User {
  id    Int    @id @default(autoincrement())
  posts Post[]
}
`,
      "prisma/schema/post.prisma": `
model Post {
  id       Int  @id @default(autoincrement())
  author   User @relation(fields: [authorId], references: [id])
  authorId Int
}
`,
    });
    expect(await prismaParser.detect(dir)).toBe(true);
    const ir = await prismaParser.parse({ projectPath: dir });
    expect(ir.tables.map((t) => t.name).sort()).toEqual(["Post", "User"]);
    // Relation defined across two files resolves correctly.
    const rel = ir.relations.find((r) => r.fromTable === "Post" && r.toTable === "User");
    expect(rel).toMatchObject({ fromColumns: ["authorId"], toColumns: ["id"] });
  });

  it("does not clobber an existing url when injecting the placeholder", async () => {
    const realUrl = 'url      = env("DATABASE_URL")';
    const dir = await makeProject({
      "prisma/schema.prisma": `
datasource db {
  provider = "postgresql"
  ${realUrl}
}
model Widget {
  id Int @id @default(autoincrement())
}
`,
    });
    const ir = await prismaParser.parse({ projectPath: dir });
    expect(ir.tables.map((t) => t.name)).toEqual(["Widget"]);
  });

  it("injects url when the only url= line is commented out", async () => {
    const dir = await makeProject({
      "prisma/schema.prisma": `
datasource db {
  provider = "postgresql"
  // url = env("DATABASE_URL")
}
model Gadget {
  id Int @id @default(autoincrement())
}
`,
    });
    // Without comment-stripping this would fail getDMMF with "url is missing".
    const ir = await prismaParser.parse({ projectPath: dir });
    expect(ir.tables.map((t) => t.name)).toEqual(["Gadget"]);
  });
});
