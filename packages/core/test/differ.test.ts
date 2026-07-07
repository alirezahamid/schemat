import { describe, expect, it } from "vitest";
import { type IRSchema, diff, emptySchema } from "../src/index";

function col(name: string, over: Partial<IRSchema["tables"][number]["columns"][number]> = {}) {
  return {
    name,
    type: "string",
    nullable: false,
    isPrimaryKey: false,
    isUnique: false,
    default: null,
    comment: null,
    ...over,
  };
}

const base: IRSchema = {
  version: 1,
  enums: [],
  relations: [],
  tables: [
    { name: "User", comment: null, columns: [col("id", { isPrimaryKey: true }), col("email")] },
  ],
};

describe("differ", () => {
  it("reports no changes for identical schemas", () => {
    expect(diff(base, structuredClone(base))).toEqual([]);
  });

  it("detects an added table", () => {
    const after = structuredClone(base);
    after.tables.push({ name: "Post", comment: null, columns: [col("id")] });
    expect(diff(base, after)).toContainEqual({ kind: "table.added", table: "Post" });
  });

  it("detects a removed table", () => {
    const after = emptySchema();
    expect(diff(base, after)).toContainEqual({ kind: "table.removed", table: "User" });
  });

  it("detects an added column", () => {
    const after = structuredClone(base);
    after.tables[0]?.columns.push(col("name"));
    expect(diff(base, after)).toContainEqual({
      kind: "column.added",
      table: "User",
      column: "name",
    });
  });

  it("detects a changed column signature", () => {
    const after = structuredClone(base);
    const email = after.tables[0]?.columns.find((c) => c.name === "email");
    if (email) email.nullable = true;
    const changes = diff(base, after);
    expect(changes.some((c) => c.kind === "column.changed" && c.column === "email")).toBe(true);
  });

  it("detects added and removed relations", () => {
    const after = structuredClone(base);
    after.relations.push({
      name: "rel1",
      fromTable: "User",
      fromColumns: ["id"],
      toTable: "User",
      toColumns: ["id"],
      cardinality: "one-to-one",
    });
    expect(diff(base, after)).toContainEqual({ kind: "relation.added", name: "rel1" });
    expect(diff(after, base)).toContainEqual({ kind: "relation.removed", name: "rel1" });
  });

  it("detects a changed relation (same name, different cardinality)", () => {
    const before = structuredClone(base);
    before.relations.push({
      name: "rel1",
      fromTable: "Post",
      fromColumns: ["authorId"],
      toTable: "User",
      toColumns: ["id"],
      cardinality: "one-to-many",
    });
    const after = structuredClone(before);
    const rel = after.relations.find((r) => r.name === "rel1");
    if (rel) rel.cardinality = "one-to-one";
    const changes = diff(before, after);
    expect(changes.some((c) => c.kind === "relation.changed" && c.name === "rel1")).toBe(true);
  });

  it("does not report unchanged relations", () => {
    const withRel = structuredClone(base);
    withRel.relations.push({
      name: "rel1",
      fromTable: "Post",
      fromColumns: ["authorId"],
      toTable: "User",
      toColumns: ["id"],
      cardinality: "one-to-many",
    });
    expect(diff(withRel, structuredClone(withRel))).toEqual([]);
  });
});
