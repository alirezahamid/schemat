import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSchema } from "@schemat/core";
import { afterAll, describe, expect, it } from "vitest";
import { mikroormParser } from "../src/index";

const dirs: string[] = [];

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "mikroorm-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const USER_ENTITY = `
import { Entity, PrimaryKey, Property, Enum, ManyToOne, OneToOne, OneToMany, ManyToMany, Collection } from "@mikro-orm/core";

export enum UserRole { Admin = "admin", Member = "member" }

@Entity({ tableName: "users" })
export class User {
  @PrimaryKey()
  id!: number;

  @Property({ unique: true })
  email!: string;

  @Property({ nullable: true })
  name?: string;

  @Property({ default: "true" })
  active!: boolean;

  @Enum(() => UserRole)
  role!: UserRole;

  @Enum({ items: ["a", "b", "c"] })
  tier!: string;

  @ManyToOne(() => Organization)
  org!: Organization;

  @OneToOne(() => Profile)
  profile!: Profile;

  @OneToMany(() => Post, (p) => p.author)
  posts = new Collection<Post>(this);

  @ManyToMany(() => Tag)
  tags = new Collection<Tag>(this);
}

@Entity()
export class Organization {
  @PrimaryKey()
  id!: number;
}

@Entity({ tableName: "profiles" })
export class Profile {
  @PrimaryKey()
  id!: number;
}

@Entity()
export class Post {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => User)
  author!: User;

  @ManyToMany({ entity: () => Tag, mappedBy: "posts" })
  tags = new Collection<Tag>(this);
}

@Entity()
export class Tag {
  @PrimaryKey()
  id!: number;
}
`;

describe("mikroormParser.detect", () => {
  it("does NOT detect on a @mikro-orm dependency alone (no entity file)", async () => {
    const dir = makeProject({
      "package.json": JSON.stringify({ dependencies: { "@mikro-orm/core": "^6.0.0" } }),
    });
    // A bare dependency is not enough — an actual @Entity must be present.
    expect(await mikroormParser.detect(dir)).toBe(false);
  });

  it("detects a @mikro-orm project that has an entity file", async () => {
    const dir = makeProject({
      "package.json": JSON.stringify({ dependencies: { "@mikro-orm/core": "^6.0.0" } }),
      "src/user.entity.ts": USER_ENTITY,
    });
    expect(await mikroormParser.detect(dir)).toBe(true);
  });

  it("detects via a file importing @mikro-orm/core", async () => {
    const dir = makeProject({ "src/user.entity.ts": USER_ENTITY });
    expect(await mikroormParser.detect(dir)).toBe(true);
  });

  it("does NOT detect a TypeORM project (uses @Entity but imports typeorm)", async () => {
    const dir = makeProject({
      "user.entity.ts":
        'import { Entity, PrimaryColumn } from "typeorm";\n@Entity()\nclass User {}',
    });
    expect(await mikroormParser.detect(dir)).toBe(false);
  });

  it("returns false for an empty directory", async () => {
    const dir = makeProject({});
    expect(await mikroormParser.detect(dir)).toBe(false);
  });
});

describe("mikroormParser.parse", () => {
  it("maps entities to tables, honoring tableName option", async () => {
    const dir = makeProject({ "src/user.entity.ts": USER_ENTITY });
    const ir = await mikroormParser.parse({ projectPath: dir });
    const names = ir.tables.map((t) => t.name).sort();
    expect(names).toEqual(["Organization", "Post", "Tag", "profiles", "users"]);
    expect(() => parseSchema(ir)).not.toThrow();
  });

  it("extracts primary key, unique, nullable, and default columns", async () => {
    const dir = makeProject({ "src/user.entity.ts": USER_ENTITY });
    const ir = await mikroormParser.parse({ projectPath: dir });
    const users = ir.tables.find((t) => t.name === "users");
    const id = users?.columns.find((c) => c.name === "id");
    expect(id?.isPrimaryKey).toBe(true);
    const email = users?.columns.find((c) => c.name === "email");
    expect(email?.isUnique).toBe(true);
    expect(email?.nullable).toBe(false);
    const name = users?.columns.find((c) => c.name === "name");
    expect(name?.nullable).toBe(true);
    const active = users?.columns.find((c) => c.name === "active");
    expect(active?.default).toBe("true");
  });

  it("resolves an identifier @Enum(() => UserRole) to its members", async () => {
    const dir = makeProject({ "src/user.entity.ts": USER_ENTITY });
    const ir = await mikroormParser.parse({ projectPath: dir });
    const roleEnum = ir.enums.find((e) => e.name === "UserRole");
    expect(roleEnum).toBeTruthy();
    expect(roleEnum?.values).toEqual(["admin", "member"]);
  });

  it("creates a named enum for inline @Enum({ items: [...] })", async () => {
    const dir = makeProject({ "src/user.entity.ts": USER_ENTITY });
    const ir = await mikroormParser.parse({ projectPath: dir });
    const tierEnum = ir.enums.find((e) => e.name === "users_tier_enum");
    expect(tierEnum).toBeTruthy();
    expect(tierEnum?.values).toEqual(["a", "b", "c"]);
  });

  it("maps @ManyToOne to a one-to-many relation resolving to the target table name", async () => {
    const dir = makeProject({ "src/user.entity.ts": USER_ENTITY });
    const ir = await mikroormParser.parse({ projectPath: dir });
    // User.org @ManyToOne(() => Organization) -> one-to-many to "Organization"
    const rel = ir.relations.find((r) => r.name === "users_org");
    expect(rel).toBeTruthy();
    expect(rel?.cardinality).toBe("one-to-many");
    expect(rel?.fromTable).toBe("users");
    expect(rel?.toTable).toBe("Organization");
    expect(rel?.fromColumns).toEqual(["orgId"]);
  });

  it("maps @OneToOne to a one-to-one relation to the table name (profiles)", async () => {
    const dir = makeProject({ "src/user.entity.ts": USER_ENTITY });
    const ir = await mikroormParser.parse({ projectPath: dir });
    const rel = ir.relations.find((r) => r.name === "users_profile");
    expect(rel).toBeTruthy();
    expect(rel?.cardinality).toBe("one-to-one");
    expect(rel?.toTable).toBe("profiles");
  });

  it("maps owning @ManyToMany to a many-to-many relation with empty columns", async () => {
    const dir = makeProject({ "src/user.entity.ts": USER_ENTITY });
    const ir = await mikroormParser.parse({ projectPath: dir });
    const rel = ir.relations.find((r) => r.name === "users_tags");
    expect(rel).toBeTruthy();
    expect(rel?.cardinality).toBe("many-to-many");
    expect(rel?.fromColumns).toEqual([]);
    expect(rel?.toColumns).toEqual([]);
  });

  it("skips @OneToMany (inverse of ManyToOne) and mappedBy @ManyToMany", async () => {
    const dir = makeProject({ "src/user.entity.ts": USER_ENTITY });
    const ir = await mikroormParser.parse({ projectPath: dir });
    // User.posts is @OneToMany -> no relation named users_posts
    expect(ir.relations.find((r) => r.name === "users_posts")).toBeUndefined();
    // Post.tags is @ManyToMany with mappedBy -> skipped (inverse side)
    expect(ir.relations.find((r) => r.name === "Post_tags")).toBeUndefined();
    // But Post.author @ManyToOne -> one-to-many to users exists
    const authorRel = ir.relations.find((r) => r.name === "Post_author");
    expect(authorRel?.toTable).toBe("users");
    expect(authorRel?.cardinality).toBe("one-to-many");
  });

  it("emits exactly one cardinality never equal to many-to-one", async () => {
    const dir = makeProject({ "src/user.entity.ts": USER_ENTITY });
    const ir = await mikroormParser.parse({ projectPath: dir });
    for (const r of ir.relations) {
      expect(["one-to-one", "one-to-many", "many-to-many"]).toContain(r.cardinality);
    }
  });

  it("respects input.files to restrict parsed entities", async () => {
    const dir = makeProject({
      "src/user.entity.ts": USER_ENTITY,
      "src/other.entity.ts":
        'import { Entity, PrimaryKey } from "@mikro-orm/core";\n@Entity()\nexport class Other { @PrimaryKey() id!: number; }',
    });
    const ir = await mikroormParser.parse({ projectPath: dir, files: ["src/other.entity.ts"] });
    expect(ir.tables.map((t) => t.name)).toEqual(["Other"]);
  });

  it("does not throw on a malformed entity file", async () => {
    const dir = makeProject({
      "src/broken.entity.ts":
        'import { Entity, Property } from "@mikro-orm/core";\n@Entity()\nexport class Broken {\n  @Property()\n  name?: string',
    });
    const ir = await mikroormParser.parse({ projectPath: dir });
    expect(() => parseSchema(ir)).not.toThrow();
  });
});
