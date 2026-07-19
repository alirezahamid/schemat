import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSchema } from "@schemat/core";
import type { IRSchema } from "@schemat/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { typeormParser } from "../src/index";

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

let root: string;

const USER_ENTITY = `
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToOne,
  ManyToMany,
  JoinTable,
  JoinColumn,
} from 'typeorm';
import { Role } from './role.entity';
import { Profile } from './profile.entity';
import { Tag } from './tag.entity';

export enum UserStatus {
  Active = 'active',
  Banned = 'banned',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({ nullable: true })
  name?: string;

  @Column({ type: 'enum', enum: UserStatus, default: 'active' })
  status: UserStatus;

  @Column({ type: 'enum', enum: ['red', 'green', 'blue'] })
  color: string;

  @ManyToOne(() => Role)
  role: Role;

  @OneToOne(() => Profile)
  @JoinColumn()
  profile: Profile;

  @ManyToMany(() => Tag)
  @JoinTable()
  tags: Tag[];
}
`;

const ROLE_ENTITY = `
import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { User } from './user.entity';

@Entity()
export class Role {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @OneToMany(() => User, (u) => u.role)
  users: User[];
}
`;

const PROFILE_ENTITY = `
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('profiles')
export class Profile {
  @PrimaryColumn()
  id: number;

  @Column({ default: 0 })
  age: number;
}
`;

const TAG_ENTITY = `
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  label: string;
}
`;

function writeProject(dir: string) {
  const entitiesDir = join(dir, "src", "entities");
  mkdirSync(entitiesDir, { recursive: true });
  writeFileSync(join(entitiesDir, "user.entity.ts"), USER_ENTITY);
  writeFileSync(join(entitiesDir, "role.entity.ts"), ROLE_ENTITY);
  writeFileSync(join(entitiesDir, "profile.entity.ts"), PROFILE_ENTITY);
  writeFileSync(join(entitiesDir, "tag.entity.ts"), TAG_ENTITY);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", dependencies: { typeorm: "^0.3.0" } }),
  );
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "typeorm-parser-"));
  writeProject(root);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// detect()
// ---------------------------------------------------------------------------

describe("detect", () => {
  it("detects a project with typeorm dependency", async () => {
    expect(await typeormParser.detect(root)).toBe(true);
  });

  it("detects via a *.entity.ts file that imports typeorm", async () => {
    const d = mkdtempSync(join(tmpdir(), "typeorm-entityonly-"));
    mkdirSync(join(d, "src"), { recursive: true });
    writeFileSync(
      join(d, "src", "foo.entity.ts"),
      'import { Entity } from "typeorm";\n@Entity() class Foo {}',
    );
    try {
      expect(await typeormParser.detect(d)).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("does NOT detect a MikroORM entity (uses @Entity but imports @mikro-orm/core)", async () => {
    const d = mkdtempSync(join(tmpdir(), "mikro-"));
    writeFileSync(
      join(d, "user.entity.ts"),
      'import { Entity, PrimaryKey } from "@mikro-orm/core";\n@Entity()\nclass User { @PrimaryKey() id!: number; }',
    );
    try {
      expect(await typeormParser.detect(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("detects via @Entity( decorator in a plain .ts file", async () => {
    const d = mkdtempSync(join(tmpdir(), "typeorm-decoronly-"));
    writeFileSync(join(d, "model.ts"), 'import {Entity} from "typeorm";\n@Entity()\nclass M {}');
    try {
      expect(await typeormParser.detect(d)).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("returns false for a non-typeorm project", async () => {
    const d = mkdtempSync(join(tmpdir(), "plain-"));
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "x" }));
    writeFileSync(join(d, "index.ts"), "export const x = 1;");
    try {
      expect(await typeormParser.detect(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

describe("parse", () => {
  let ir: IRSchema;

  beforeAll(async () => {
    ir = await typeormParser.parse({ projectPath: root });
  });

  it("produces a valid IR shape (version 1) validated by parseSchema", () => {
    expect(() => parseSchema(ir)).not.toThrow();
    expect(ir.version).toBe(1);
  });

  it("maps @Entity(name) argument to the table name", () => {
    const names = ir.tables.map((t) => t.name).sort();
    expect(names).toEqual(["Role", "Tag", "profiles", "users"].sort());
  });

  it("extracts primary key + unique + nullable columns", () => {
    const users = ir.tables.find((t) => t.name === "users");
    const id = users.columns.find((c) => c.name === "id");
    const email = users.columns.find((c) => c.name === "email");
    const name = users.columns.find((c) => c.name === "name");

    expect(id.isPrimaryKey).toBe(true);
    expect(id.type).toBe("number");

    expect(email.isUnique).toBe(true);
    expect(email.nullable).toBe(false);

    expect(name.nullable).toBe(true);
  });

  it("captures column default values as strings", () => {
    const profiles = ir.tables.find((t) => t.name === "profiles");
    const age = profiles.columns.find((c) => c.name === "age");
    expect(age.default).toBe("0");
  });

  it("maps @PrimaryColumn to isPrimaryKey", () => {
    const profiles = ir.tables.find((t) => t.name === "profiles");
    const id = profiles.columns.find((c) => c.name === "id");
    expect(id.isPrimaryKey).toBe(true);
  });

  it('maps PrimaryGeneratedColumn("uuid") type to uuid', () => {
    const tag = ir.tables.find((t) => t.name === "Tag");
    const id = tag.columns.find((c) => c.name === "id");
    expect(id.type).toBe("uuid");
    expect(id.isPrimaryKey).toBe(true);
  });

  it("produces an enum from type:enum + enum identifier", () => {
    const users = ir.tables.find((t) => t.name === "users");
    const status = users.columns.find((c) => c.name === "status");
    expect(status.type).toBe("UserStatus");
    // identifier-referenced enums have their name captured
    expect(ir.enums.map((e) => e.name)).toContain("UserStatus");
  });

  it("produces an enum with inline array values", () => {
    const users = ir.tables.find((t) => t.name === "users");
    const color = users.columns.find((c) => c.name === "color");
    expect(color.type).toBe("users_color_enum");
    const en = ir.enums.find((e) => e.name === "users_color_enum");
    expect(en.values).toEqual(["red", "green", "blue"]);
  });

  it("maps @ManyToOne to a one-to-many relation owned by this table", () => {
    const rel = ir.relations.find(
      (r) => r.cardinality === "one-to-many" && r.fromTable === "users",
    );
    expect(rel).toBeTruthy();
    expect(rel?.toTable).toBe("Role");
    expect(rel?.fromColumns).toEqual(["roleId"]);
    expect(rel?.toColumns).toEqual(["id"]);
  });

  it("maps @OneToOne (owning, @JoinColumn) to a one-to-one relation", () => {
    const rel = ir.relations.find((r) => r.cardinality === "one-to-one");
    expect(rel).toBeTruthy();
    expect(rel?.fromTable).toBe("users");
    expect(rel?.toTable).toBe("profiles");
    expect(rel?.fromColumns).toEqual(["profileId"]);
  });

  it("maps @ManyToMany + @JoinTable to a many-to-many relation with empty columns", () => {
    const rel = ir.relations.find((r) => r.cardinality === "many-to-many");
    expect(rel).toBeTruthy();
    expect(rel?.fromTable).toBe("users");
    expect(rel?.toTable).toBe("Tag");
    expect(rel?.fromColumns).toEqual([]);
    expect(rel?.toColumns).toEqual([]);
  });

  it("does NOT emit a relation for the inverse @OneToMany side", () => {
    // Role.users is @OneToMany -> should be skipped (no duplicate edge)
    const fromRole = ir.relations.filter((r) => r.fromTable === "Role");
    expect(fromRole).toHaveLength(0);
  });

  it("resolves relation targets from the entity CLASS name to its table name", async () => {
    // Regression: @OneToOne(() => Profile) references the CLASS `Profile`, but
    // that entity is declared @Entity('profiles'). The relation's toTable must
    // resolve to the real table name 'profiles', not the class name 'Profile',
    // otherwise the diagram edge points at a table that doesn't exist.
    const rel = ir.relations.find((r) => r.cardinality === "one-to-one");
    expect(rel?.toTable).toBe("profiles");
    // And the @ManyToOne(() => Role) target resolves to Role's table. Role uses
    // a bare @Entity(), so its table name IS the class name 'Role'.
    const m2o = ir.relations.find(
      (r) => r.cardinality === "one-to-many" && r.fromTable === "users",
    );
    expect(m2o?.toTable).toBe("Role");
  });

  it("respects input.files to restrict parsed entities", async () => {
    const only = await typeormParser.parse({
      projectPath: root,
      files: ["src/entities/profile.entity.ts"],
    });
    expect(only.tables.map((t) => t.name)).toEqual(["profiles"]);
    expect(only.relations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("returns an empty valid schema for a project with no entities", async () => {
    const d = mkdtempSync(join(tmpdir(), "empty-"));
    writeFileSync(join(d, "index.ts"), "export const x = 1;");
    try {
      const ir = await typeormParser.parse({ projectPath: d });
      expect(ir.version).toBe(1);
      expect(ir.tables).toEqual([]);
      expect(ir.relations).toEqual([]);
      expect(ir.enums).toEqual([]);
      expect(() => parseSchema(ir)).not.toThrow();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("handles a malformed / partial entity without throwing", async () => {
    const d = mkdtempSync(join(tmpdir(), "malformed-"));
    // Missing closing brace + bare @Column() with no options; ts-morph
    // parses leniently. Parser must not crash.
    writeFileSync(
      join(d, "broken.entity.ts"),
      `import { Entity, Column } from 'typeorm';
@Entity('broken')
export class Broken {
  @Column()
  name: string
`,
    );
    try {
      const ir = await typeormParser.parse({ projectPath: d });
      const t = ir.tables.find((x) => x.name === "broken");
      expect(t).toBeTruthy();
      // bare @Column() falls back to the TS property type
      const name = t?.columns.find((c) => c.name === "name");
      expect(name.type).toBe("string");
      expect(() => parseSchema(ir)).not.toThrow();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("detect returns false for an empty directory", async () => {
    const d = mkdtempSync(join(tmpdir(), "nothing-"));
    try {
      expect(await typeormParser.detect(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
