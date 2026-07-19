# @schemat/cli

## 0.2.0

### Minor Changes

- [#18](https://github.com/alirezahamid/schemat/pull/18) [`95f5cff`](https://github.com/alirezahamid/schemat/commit/95f5cfff55ad964080848c1ba8574efc1213465b) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Add a DBML parser (`@schemat/parser-dbml`). Schemat now reads
  [DBML](https://dbml.dbdiagram.io/) schemas — the format used by dbdiagram.io —
  from `schema.dbml` (and other common locations), mapping tables, columns, enums,
  and refs (with cardinality) into the diagram. Registered in the CLI's parser
  detection, so `schemat dev/export/snapshot/check` work on DBML projects.

- [#19](https://github.com/alirezahamid/schemat/pull/19) [`8e8c45f`](https://github.com/alirezahamid/schemat/commit/8e8c45fd519fbfe7c718436bd002aa9e40d9c683) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Add a Drizzle ORM parser (`@schemat/parser-drizzle`). Schemat now reads
  [Drizzle](https://orm.drizzle.team/) schemas by statically parsing the
  TypeScript (via `ts-morph`) — no database connection, no code execution. Maps
  `pgTable`/`mysqlTable`/`sqliteTable`, column builders and modifiers
  (`.primaryKey`/`.notNull`/`.unique`/`.default`/`.references`), and `pgEnum` into
  tables, columns, enums, and relations (with cardinality). Registered in the CLI's
  parser detection so `dev`/`export`/`snapshot`/`check` work on Drizzle projects.

- [#22](https://github.com/alirezahamid/schemat/pull/22) [`f90c069`](https://github.com/alirezahamid/schemat/commit/f90c069ea15e98427440a45f687a8323e41afa17) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Add a MikroORM parser (`@schemat/parser-mikroorm`). Schemat now reads MikroORM
  entity classes by statically parsing the TypeScript (via `ts-morph`) — no
  database connection, no code execution. Maps `@Entity` classes to tables,
  `@PrimaryKey`/`@Property` to columns (nullable/unique/default/type), `@Enum`
  (identifier and inline-array forms) to enums, and relation decorators to IR
  relations (`@ManyToOne` → one-to-many, `@OneToOne` → one-to-one, owning
  `@ManyToMany` → many-to-many; `@OneToMany` and `mappedBy` inverse sides skipped).
  Relation targets resolve from the entity class name to its real table name.
  `detect()` requires a `@mikro-orm` import signal so it doesn't collide with
  TypeORM's `@Entity`. Registered in the CLI's parser detection.

- [#21](https://github.com/alirezahamid/schemat/pull/21) [`287562a`](https://github.com/alirezahamid/schemat/commit/287562af033f237a13ce8d25c6120f91b38064a9) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Add a Mongoose parser (`@schemat/parser-mongoose`). Schemat now reads Mongoose
  schema definitions by statically parsing the source (via `ts-morph`) — no
  database connection, no code execution. Maps `new Schema({...})` +
  `model('Name', …)` to tables (with an implicit `_id` ObjectId primary key),
  shorthand and options-object fields to columns (required/unique/default/type),
  `enum: [...]` to enums, and `ref` conventions to relations (`ObjectId` ref →
  one-to-many, array-of-ref → many-to-many). Registered in the CLI's parser
  detection so `dev`/`export`/`snapshot`/`check` work on Mongoose projects.

- [#20](https://github.com/alirezahamid/schemat/pull/20) [`e90a7b0`](https://github.com/alirezahamid/schemat/commit/e90a7b03a0a15f50a7dcf53de4d713e3aaaf4d51) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Add a TypeORM parser (`@schemat/parser-typeorm`). Schemat now reads TypeORM
  entity classes by statically parsing the TypeScript (via `ts-morph`) — no
  database connection, no code execution. Maps `@Entity` classes, `@Column`
  family decorators (nullable/unique/default/type/name), `@PrimaryColumn` /
  `@PrimaryGeneratedColumn`, `@Column({ type: 'enum' })`, and relations
  (`@ManyToOne`/`@OneToOne`/`@ManyToMany`) into tables, columns, enums, and
  relations with cardinality. Relation targets referenced by class are resolved
  to the real table name. Registered in the CLI's parser detection so
  `dev`/`export`/`snapshot`/`check` work on TypeORM projects.

- [#17](https://github.com/alirezahamid/schemat/pull/17) [`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Real-world Prisma robustness: parse schemas that don't statically validate but that Schemat can still render (it never connects to a database).

  - **Datasource without a static `url`** (e.g. `directUrl`-only, or url supplied at runtime) no longer errors with `Argument "url" is missing`. A harmless placeholder url is injected before validation and never used.
  - **Multi-file schemas** (`prismaSchemaFolder`: `prisma/schema/*.prisma`) are now detected and parsed — all files are concatenated.
  - **Monorepo discovery**: when no schema is found at the root, Schemat now scans `apps/*`, `packages/*`, `services/*`, `libs/*` and lists the sub-projects that contain a schema, telling you exactly which `--root` to pass.

  Verified against 7 large public schemas (cal.com 102 tables, dub 82, trigger.dev 77, langfuse 71, documenso 51, formbricks 49, umami 18).

### Patch Changes

- Updated dependencies [[`95f5cff`](https://github.com/alirezahamid/schemat/commit/95f5cfff55ad964080848c1ba8574efc1213465b), [`8e8c45f`](https://github.com/alirezahamid/schemat/commit/8e8c45fd519fbfe7c718436bd002aa9e40d9c683), [`f90c069`](https://github.com/alirezahamid/schemat/commit/f90c069ea15e98427440a45f687a8323e41afa17), [`287562a`](https://github.com/alirezahamid/schemat/commit/287562af033f237a13ce8d25c6120f91b38064a9), [`e90a7b0`](https://github.com/alirezahamid/schemat/commit/e90a7b03a0a15f50a7dcf53de4d713e3aaaf4d51), [`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481)]:
  - @schemat/parser-dbml@0.2.0
  - @schemat/parser-drizzle@0.2.0
  - @schemat/parser-mikroorm@0.2.0
  - @schemat/parser-mongoose@0.2.0
  - @schemat/parser-typeorm@0.2.0
  - @schemat/core@0.2.0
  - @schemat/parser-prisma@0.2.0
  - @schemat/parser-sql@0.2.0
  - @schemat/render@0.2.0
  - @schemat/web@0.2.0
