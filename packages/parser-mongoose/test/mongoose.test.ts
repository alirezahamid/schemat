import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IRSchema } from "@schemat/core";
import mongooseParser, { mongooseParser as named } from "../src/index.ts";

// -------------------------------------------------------------------------
// Test fixtures: real Mongoose model .ts files written to temp dirs.
// -------------------------------------------------------------------------

const dirs: string[] = [];

function makeProjectDir(files: Record<string, string>, withPkg = true): string {
  const dir = mkdtempSync(join(tmpdir(), "schemat-mongoose-"));
  dirs.push(dir);
  if (withPkg) {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture", dependencies: { mongoose: "^8.0.0" } }),
    );
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    const parent = abs.slice(0, abs.lastIndexOf("/"));
    mkdirSync(parent, { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

afterAll(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

// A comprehensive User model exercising required/unique/default, enum, ObjectId
// ref (one-to-many), and array-of-ref (many-to-many).
const USER_MODEL = `
import mongoose from 'mongoose';
const { Schema } = mongoose;

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  age: Number,
  role: { type: String, enum: ['admin', 'member'], default: 'member' },
  author: { type: Schema.Types.ObjectId, ref: 'User' },
  posts: [{ type: Schema.Types.ObjectId, ref: 'Post' }],
  profile: { bio: String, links: [String] },
  active: { type: Boolean, default: true },
});

export const User = mongoose.model('User', userSchema);
`;

// A Post model using destructured `new Schema(...)`.
const POST_MODEL = `
import { Schema, model } from 'mongoose';

const postSchema = new Schema({
  title: { type: String, required: true },
  body: String,
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
});

export const Post = model('Post', postSchema);
`;

describe("mongooseParser.detect", () => {
  it("detects via mongoose dependency in package.json", async () => {
    const dir = makeProjectDir({ "models/User.ts": USER_MODEL });
    expect(await mongooseParser.detect(dir)).toBe(true);
  });

  it("detects via `new Schema(` even without package.json", async () => {
    const dir = makeProjectDir({ "models/Post.ts": POST_MODEL }, false);
    expect(await mongooseParser.detect(dir)).toBe(true);
  });

  it("returns false for a project with no mongoose usage", async () => {
    const dir = makeProjectDir({ "src/util.ts": "export const x = 1;\n" }, false);
    // no package.json, no Schema, no models dir with mongoose
    expect(await mongooseParser.detect(dir)).toBe(false);
  });

  it("exposes the parser name", () => {
    expect(named.name).toBe("mongoose");
    expect(mongooseParser).toBe(named);
  });
});

describe("mongooseParser.parse — User model", () => {
  let ir: IRSchema;

  beforeAll(async () => {
    const dir = makeProjectDir({ "models/User.ts": USER_MODEL });
    ir = await mongooseParser.parse({ projectPath: dir });
  });

  it("produces a valid IR envelope", () => {
    expect(ir.version).toBe(1);
    expect(Array.isArray(ir.tables)).toBe(true);
    expect(Array.isArray(ir.enums)).toBe(true);
    expect(Array.isArray(ir.relations)).toBe(true);
  });

  it("names the table after the model", () => {
    const t = ir.tables.find((t) => t.name === "User");
    expect(t).toBeDefined();
  });

  it("adds an implicit _id primary key (ObjectId)", () => {
    const t = ir.tables.find((t) => t.name === "User");
    const id = t.columns.find((c) => c.name === "_id");
    expect(id).toBeDefined();
    expect(id.isPrimaryKey).toBe(true);
    expect(id.type).toBe("ObjectId");
    expect(id.nullable).toBe(false);
  });

  it("reads required + unique + type flags", () => {
    const t = ir.tables.find((t) => t.name === "User");
    const username = t.columns.find((c) => c.name === "username");
    expect(username.type).toBe("String");
    expect(username.nullable).toBe(false); // required
    expect(username.isUnique).toBe(true);
  });

  it("handles shorthand form (age: Number)", () => {
    const t = ir.tables.find((t) => t.name === "User");
    const age = t.columns.find((c) => c.name === "age");
    expect(age.type).toBe("Number");
    expect(age.nullable).toBe(true);
    expect(age.isUnique).toBe(false);
  });

  it("reads default values", () => {
    const t = ir.tables.find((t) => t.name === "User");
    const role = t.columns.find((c) => c.name === "role");
    expect(role.default).toBe("member");
    const active = t.columns.find((c) => c.name === "active");
    expect(active.type).toBe("Boolean");
    expect(active.default).toBe("true");
  });

  it("produces a named enum for enum String fields", () => {
    const e = ir.enums.find((e) => e.name === "User_role");
    expect(e).toBeDefined();
    expect(e?.values).toEqual(["admin", "member"]);
    const t = ir.tables.find((t) => t.name === "User");
    const role = t.columns.find((c) => c.name === "role");
    expect(role.type).toBe("User_role");
  });

  it("creates a one-to-many relation for a single ObjectId ref", () => {
    const rel = ir.relations.find((r) => r.name === "User_author");
    expect(rel).toBeDefined();
    expect(rel.fromTable).toBe("User");
    expect(rel.fromColumns).toEqual(["author"]);
    expect(rel.toTable).toBe("User");
    expect(rel.toColumns).toEqual(["_id"]);
    expect(rel.cardinality).toBe("one-to-many");
  });

  it("creates a many-to-many relation for an array-of-ref", () => {
    const rel = ir.relations.find((r) => r.name === "User_posts");
    expect(rel).toBeDefined();
    expect(rel.fromTable).toBe("User");
    expect(rel.toTable).toBe("Post");
    expect(rel.fromColumns).toEqual([]);
    expect(rel.toColumns).toEqual([]);
    expect(rel.cardinality).toBe("many-to-many");
  });

  it("collapses nested subdocuments into an Object column (v1 simplification)", () => {
    const t = ir.tables.find((t) => t.name === "User");
    const profile = t.columns.find((c) => c.name === "profile");
    expect(profile.type).toBe("Object");
  });

  it("handles array type inside options object and array-form required", async () => {
    const dir = makeProjectDir({
      "models/Team.ts": `
        import mongoose from "mongoose";
        const { Schema } = mongoose;
        const teamSchema = new Schema({
          name: { type: String, required: [true, "name is required"] },
          members: { type: [{ type: Schema.Types.ObjectId, ref: "User" }] },
        });
        export const Team = mongoose.model("Team", teamSchema);
      `,
    });
    const ir2 = await mongooseParser.parse({ projectPath: dir });
    const team = ir2.tables.find((t) => t.name === "Team");
    const name = team.columns.find((c) => c.name === "name");
    // required: [true, "..."] -> not nullable
    expect(name.nullable).toBe(false);
    // members: { type: [{...ref}] } -> a many-to-many relation to User
    const rel = ir2.relations.find((r) => r.name === "Team_members");
    expect(rel).toBeDefined();
    expect(rel.toTable).toBe("User");
    expect(rel.cardinality).toBe("many-to-many");
  });
});

describe("mongooseParser.parse — destructured Schema + model", () => {
  it("parses `new Schema(...)` and `model('Post', schema)`", async () => {
    const dir = makeProjectDir({ "models/Post.ts": POST_MODEL });
    const ir = await mongooseParser.parse({ projectPath: dir });
    const t = ir.tables.find((t) => t.name === "Post");
    expect(t).toBeDefined();
    const title = t?.columns.find((c) => c.name === "title");
    expect(title.nullable).toBe(false);
    const rel = ir.relations.find((r) => r.name === "Post_owner");
    expect(rel.toTable).toBe("User");
    expect(rel.cardinality).toBe("one-to-many");
  });
});

describe("mongooseParser.parse — respects input.files", () => {
  it("only parses the listed files", async () => {
    const dir = makeProjectDir({
      "models/User.ts": USER_MODEL,
      "models/Post.ts": POST_MODEL,
    });
    const ir = await mongooseParser.parse({
      projectPath: dir,
      files: ["models/Post.ts"],
    });
    expect(ir.tables.some((t) => t.name === "Post")).toBe(true);
    expect(ir.tables.some((t) => t.name === "User")).toBe(false);
  });
});

describe("mongooseParser.parse — fallback to schema variable name", () => {
  it("names a table from the schema var when no model() call exists", async () => {
    const dir = makeProjectDir({
      "models/Widget.ts": `
        import { Schema } from 'mongoose';
        const widgetSchema = new Schema({ label: String });
      `,
    });
    const ir = await mongooseParser.parse({ projectPath: dir });
    // "widgetSchema" -> strip "Schema" -> "widget" -> "Widget"
    const t = ir.tables.find((t) => t.name === "Widget");
    expect(t).toBeDefined();
    expect(t?.columns.some((c) => c.name === "_id" && c.isPrimaryKey)).toBe(true);
  });
});

describe("mongooseParser.parse — edge cases", () => {
  it("handles an empty project (no schemas)", async () => {
    const dir = makeProjectDir({ "src/index.ts": "export const y = 2;\n" });
    const ir = await mongooseParser.parse({ projectPath: dir });
    expect(ir.tables).toEqual([]);
    expect(ir.enums).toEqual([]);
    expect(ir.relations).toEqual([]);
  });

  it("handles an empty schema `new Schema({})`", async () => {
    const dir = makeProjectDir({
      "models/Empty.ts": `
        import { Schema, model } from 'mongoose';
        const s = new Schema({});
        export const Empty = model('Empty', s);
      `,
    });
    const ir = await mongooseParser.parse({ projectPath: dir });
    const t = ir.tables.find((t) => t.name === "Empty");
    expect(t).toBeDefined();
    // Only the implicit _id column.
    expect(t.columns).toHaveLength(1);
    expect(t.columns[0].name).toBe("_id");
  });

  it("does not throw on malformed / partial source", async () => {
    const dir = makeProjectDir({
      "models/Broken.ts": `
        import { Schema, model } from 'mongoose';
        const brokenSchema = new Schema({
          name: { type: String, required: true
          // missing closing brace + trailing junk
        export const Broken = model('Broken'
      `,
    });
    // Should not throw; parser tolerates malformed input and returns valid IR.
    const ir = await mongooseParser.parse({ projectPath: dir });
    expect(ir.version).toBe(1);
    expect(Array.isArray(ir.tables)).toBe(true);
  });

  it("emits a model table even when the schema var cannot be linked", async () => {
    const dir = makeProjectDir({
      "models/Ghost.ts": `
        import mongoose from 'mongoose';
        export const Ghost = mongoose.model('Ghost', someExternalSchema);
      `,
    });
    const ir = await mongooseParser.parse({ projectPath: dir });
    const t = ir.tables.find((t) => t.name === "Ghost");
    expect(t).toBeDefined();
    expect(t.columns).toHaveLength(1); // just _id
    expect(t.columns[0].isPrimaryKey).toBe(true);
  });
});
