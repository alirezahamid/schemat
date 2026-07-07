import { describe, expect, it } from "vitest";
import { IRSchema, emptySchema, parseSchema } from "../src/index";

describe("IR validation", () => {
  it("accepts an empty schema", () => {
    expect(() => parseSchema(emptySchema())).not.toThrow();
  });

  it("accepts a well-formed schema", () => {
    const schema = {
      version: 1,
      enums: [{ name: "Role", values: ["USER", "ADMIN"] }],
      tables: [
        {
          name: "User",
          comment: null,
          columns: [
            {
              name: "id",
              type: "int",
              nullable: false,
              isPrimaryKey: true,
              isUnique: true,
              default: "autoincrement()",
              comment: null,
            },
            {
              name: "email",
              type: "string",
              nullable: false,
              isPrimaryKey: false,
              isUnique: true,
              default: null,
              comment: null,
            },
          ],
        },
        {
          name: "Post",
          comment: null,
          columns: [
            {
              name: "id",
              type: "int",
              nullable: false,
              isPrimaryKey: true,
              isUnique: true,
              default: null,
              comment: null,
            },
            {
              name: "authorId",
              type: "int",
              nullable: false,
              isPrimaryKey: false,
              isUnique: false,
              default: null,
              comment: null,
            },
          ],
        },
      ],
      relations: [
        {
          name: "Post_authorId_fkey",
          fromTable: "Post",
          fromColumns: ["authorId"],
          toTable: "User",
          toColumns: ["id"],
          cardinality: "one-to-many",
        },
      ],
    };
    const parsed = parseSchema(schema);
    expect(parsed.tables).toHaveLength(2);
    expect(parsed.relations[0]?.cardinality).toBe("one-to-many");
  });

  it("rejects a wrong version", () => {
    expect(() => parseSchema({ ...emptySchema(), version: 2 })).toThrow();
  });

  it("rejects a bad cardinality", () => {
    const bad = {
      version: 1,
      tables: [],
      enums: [],
      relations: [
        {
          name: "x",
          fromTable: "A",
          fromColumns: ["a"],
          toTable: "B",
          toColumns: ["b"],
          cardinality: "many-to-one",
        },
      ],
    };
    expect(() => IRSchema.parse(bad)).toThrow();
  });

  it("rejects an empty column name", () => {
    const bad = {
      version: 1,
      enums: [],
      relations: [],
      tables: [
        {
          name: "T",
          comment: null,
          columns: [
            {
              name: "",
              type: "int",
              nullable: false,
              isPrimaryKey: false,
              isUnique: false,
              default: null,
              comment: null,
            },
          ],
        },
      ],
    };
    expect(() => IRSchema.parse(bad)).toThrow();
  });
});
