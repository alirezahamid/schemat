import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSchema } from "@schemat/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sequelizeParser } from "../src/index";

let root: string;

const USER_MODEL = `
import { DataTypes, Model, Sequelize } from 'sequelize';

export class User extends Model {
  declare id: number;
  declare email: string;
  declare status: string;
}

export function initUser(sequelize: Sequelize) {
  User.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      status: {
        type: DataTypes.ENUM('active', 'banned'),
        defaultValue: 'active',
      },
      roleId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
    },
  );
}
`;

const ROLE_MODEL = `
import { DataTypes, Sequelize } from 'sequelize';

export function defineRole(sequelize: Sequelize) {
  return sequelize.define(
    'Role',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    },
    { tableName: 'roles' },
  );
}
`;

const ASSOCS = `
import { User } from './user';
import { Role } from './role';

export function associate() {
  User.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });
  Role.hasMany(User, { foreignKey: 'roleId', as: 'users' });
  User.belongsToMany(Role, { through: 'user_roles', as: 'roles' });
}
`;

function writeProject(dir: string) {
  const models = join(dir, "src", "models");
  mkdirSync(models, { recursive: true });
  writeFileSync(join(models, "user.ts"), USER_MODEL);
  writeFileSync(join(models, "role.ts"), ROLE_MODEL);
  writeFileSync(join(models, "assocs.ts"), ASSOCS);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", dependencies: { sequelize: "^6.0.0" } }),
  );
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "sequelize-parser-"));
  writeProject(root);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("detect", () => {
  it("detects sequelize dependency", async () => {
    expect(await sequelizeParser.detect(root)).toBe(true);
  });

  it("detects via define/init without package.json dep", async () => {
    const d = mkdtempSync(join(tmpdir(), "sequelize-nodep-"));
    mkdirSync(join(d, "src"), { recursive: true });
    writeFileSync(
      join(d, "src", "m.js"),
      `const { Sequelize, DataTypes } = require('sequelize');\nsequelize.define('X', { id: DataTypes.INTEGER });\n`,
    );
    try {
      expect(await sequelizeParser.detect(d)).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("does not false-positive empty project", async () => {
    const d = mkdtempSync(join(tmpdir(), "sequelize-empty-"));
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "x" }));
    try {
      expect(await sequelizeParser.detect(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("parse", () => {
  it("returns valid IR with tables from init + define", async () => {
    const result = await sequelizeParser.parse({ projectPath: root });
    const schema = "schema" in result ? result.schema : result;
    parseSchema(schema);

    const names = schema.tables.map((t) => t.name).sort();
    expect(names).toEqual(["roles", "users"]);

    const users = schema.tables.find((t) => t.name === "users");
    expect(users).toBeTruthy();
    const email = users?.columns.find((c) => c.name === "email");
    expect(email?.nullable).toBe(false);
    expect(email?.isUnique).toBe(true);
    expect(email?.type).toBe("string");
    expect(email?.rawType).toMatch(/STRING/);
    expect(email?.isList).toBe(false);

    const id = users?.columns.find((c) => c.name === "id");
    expect(id?.isPrimaryKey).toBe(true);
    expect(id?.nullable).toBe(false);
    expect(id?.type).toBe("int");
  });

  it("captures ENUM values with closed type", async () => {
    const result = await sequelizeParser.parse({ projectPath: root });
    const schema = "schema" in result ? result.schema : result;
    expect(schema.enums.length).toBeGreaterThan(0);
    const e = schema.enums.find((x) => x.values.includes("active"));
    expect(e?.values).toEqual(["active", "banned"]);
    const status = schema.tables
      .find((t) => t.name === "users")
      ?.columns.find((c) => c.name === "status");
    expect(status?.type).toBe("enum");
    expect(status?.rawType).toBe(e?.name);
  });

  it("maps ARRAY element type and sets isList", async () => {
    const d = mkdtempSync(join(tmpdir(), "sequelize-array-"));
    mkdirSync(join(d, "src"), { recursive: true });
    writeFileSync(
      join(d, "src", "tags.ts"),
      `
import { DataTypes, Sequelize } from 'sequelize';
export function defineTag(sequelize: Sequelize) {
  return sequelize.define('TagBag', {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    labels: { type: DataTypes.ARRAY(DataTypes.STRING) },
  }, { tableName: 'tag_bags' });
}
`,
    );
    writeFileSync(
      join(d, "package.json"),
      JSON.stringify({ name: "fixture", dependencies: { sequelize: "^6.0.0" } }),
    );
    try {
      const result = await sequelizeParser.parse({ projectPath: d });
      const schema = "schema" in result ? result.schema : result;
      parseSchema(schema);
      const labels = schema.tables[0]?.columns.find((c) => c.name === "labels");
      expect(labels?.type).toBe("string");
      expect(labels?.isList).toBe(true);
      expect(labels?.rawType).toMatch(/ARRAY/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("emits belongsTo and belongsToMany relations", async () => {
    const result = await sequelizeParser.parse({ projectPath: root });
    const schema = "schema" in result ? result.schema : result;
    const kinds = schema.relations.map((r) => r.cardinality);
    expect(kinds).toContain("one-to-many");
    expect(kinds).toContain("many-to-many");

    const bt = schema.relations.find((r) => r.name === "role" || r.fromColumns.includes("roleId"));
    expect(bt).toBeTruthy();
    expect(bt?.fromTable).toBe("users");
    expect(bt?.toTable).toBe("roles");
  });

  it("accepts explicit files override", async () => {
    const onlyRole = join(root, "src", "models", "role.ts");
    const result = await sequelizeParser.parse({ projectPath: root, files: [onlyRole] });
    const schema = "schema" in result ? result.schema : result;
    expect(schema.tables.map((t) => t.name)).toEqual(["roles"]);
  });
});
