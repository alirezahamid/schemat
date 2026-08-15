import { describe, expect, it } from "vitest";
import { IRSchema, emptySchema, parseSchema } from "../src/index";

describe("IR validation", () => {
  it("accepts an empty schema", () => {
    expect(() => parseSchema(emptySchema())).not.toThrow();
    expect(emptySchema().version).toBe(2);
  });

  it("accepts a well-formed schema", () => {
    const schema = {
      version: 2,
      enums: [{ name: "Role", values: ["USER", "ADMIN"] }],
      tables: [
        {
          name: "User",
          comment: null,
          columns: [
            {
              name: "id",
              type: "int",
              rawType: "Int",
              nullable: false,
              isPrimaryKey: true,
              isUnique: true,
              isList: false,
              default: "autoincrement()",
              comment: null,
            },
            {
              name: "email",
              type: "string",
              rawType: "String",
              nullable: false,
              isPrimaryKey: false,
              isUnique: true,
              isList: false,
              default: null,
              comment: null,
            },
            {
              name: "tags",
              type: "string",
              rawType: "String",
              nullable: false,
              isPrimaryKey: false,
              isUnique: false,
              isList: true,
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
              rawType: "Int",
              nullable: false,
              isPrimaryKey: true,
              isUnique: true,
              isList: false,
              default: null,
              comment: null,
            },
            {
              name: "authorId",
              type: "int",
              rawType: "Int",
              nullable: false,
              isPrimaryKey: false,
              isUnique: false,
              isList: false,
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
    expect(parsed.tables[0]?.columns.find((c) => c.name === "tags")?.isList).toBe(true);
  });

  it("rejects a wrong version (v1 snapshots must be regenerated)", () => {
    expect(() => parseSchema({ ...emptySchema(), version: 1 })).toThrow();
  });

  it("rejects free-form type strings outside the canonical enum", () => {
    const bad = {
      version: 2,
      enums: [],
      relations: [],
      tables: [
        {
          name: "T",
          comment: null,
          columns: [
            {
              name: "x",
              type: "varchar",
              rawType: "varchar",
              nullable: false,
              isPrimaryKey: false,
              isUnique: false,
              isList: false,
              default: null,
              comment: null,
            },
          ],
        },
      ],
    };
    expect(() => IRSchema.parse(bad)).toThrow();
  });

  it("rejects a bad cardinality", () => {
    const bad = {
      version: 2,
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
      version: 2,
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
              rawType: "int",
              nullable: false,
              isPrimaryKey: false,
              isUnique: false,
              isList: false,
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
