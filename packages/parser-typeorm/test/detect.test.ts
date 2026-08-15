import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { typeormParser } from "../src/index";

/**
 * NestJS monorepos rarely import `typeorm` directly in entity files: decorators
 * come from a shared barrel, and `typeorm` itself is hoisted to the workspace
 * root. Both used to read as "not a TypeORM project".
 */

let root: string;

function write(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "typeorm-detect-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("typeorm detect", () => {
  it("detects entities whose decorators come from a shared barrel", async () => {
    write("package.json", JSON.stringify({ name: "root", dependencies: { typeorm: "0.3.20" } }));
    write("apps/identity/package.json", JSON.stringify({ name: "identity" }));
    write(
      "apps/identity/src/user.entity.ts",
      `import { Entity, Column, PrimaryGeneratedColumn } from "@app/common/database";
import { ApiProperty } from "@nestjs/swagger";

@Entity("users")
export class UserEntity {
  @PrimaryGeneratedColumn() id: number;
  @ApiProperty()
  @Column() email: string;
}
`,
    );

    expect(await typeormParser.detect(join(root, "apps/identity"))).toBe(true);
  });

  it("detects a service when typeorm is hoisted to the workspace root", async () => {
    write("package.json", JSON.stringify({ name: "root", dependencies: { typeorm: "0.3.20" } }));
    write("apps/api/package.json", JSON.stringify({ name: "api" }));
    write(
      "apps/api/src/post.entity.ts",
      `import { Entity, Column, PrimaryGeneratedColumn } from "../../../db";

@Entity()
export class Post {
  @PrimaryGeneratedColumn() id: number;
  @Column() title: string;
}
`,
    );

    expect(await typeormParser.detect(join(root, "apps/api"))).toBe(true);
  });

  it("does not claim workspace packages that have no entity", async () => {
    write("package.json", JSON.stringify({ name: "root", dependencies: { typeorm: "0.3.20" } }));
    write("packages/utils/package.json", JSON.stringify({ name: "utils" }));
    write("packages/utils/src/util.ts", "export const x = 1;\n");

    expect(await typeormParser.detect(join(root, "packages/utils"))).toBe(false);
  });

  it("does not claim MikroORM entities", async () => {
    write("package.json", JSON.stringify({ name: "m", dependencies: { "@mikro-orm/core": "6" } }));
    write(
      "src/user.entity.ts",
      `import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity()
export class User {
  @PrimaryKey() id!: number;
  @Property() name!: string;
}
`,
    );

    expect(await typeormParser.detect(root)).toBe(false);
  });

  it("does not claim a MikroORM service in a typeorm-declaring workspace", async () => {
    // The hoisted-workspace rung accepts any @Entity file alongside an ancestor
    // that declares typeorm. MikroORM also uses @Entity, and this parser runs
    // first, so without the @mikro-orm/ exclusion it steals the service and
    // emits class-name tables with zero columns.
    write("package.json", JSON.stringify({ name: "root", dependencies: { typeorm: "0.3.20" } }));
    write(
      "apps/mikro-svc/package.json",
      JSON.stringify({ name: "mikro-svc", dependencies: { "@mikro-orm/core": "6" } }),
    );
    write(
      "apps/mikro-svc/src/user.entity.ts",
      `import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity({ tableName: "users" })
export class User {
  @PrimaryKey() id!: number;
  @Property() name!: string;
}
`,
    );

    expect(await typeormParser.detect(join(root, "apps/mikro-svc"))).toBe(false);
  });
});
