import path from "node:path";
import { fileURLToPath } from "node:url";
import { IRSchema } from "@schemat/core";
import { describe, expect, it } from "vitest";
import { prismaParser } from "../src/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleProject = path.resolve(here, "../../../examples/blog");

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
