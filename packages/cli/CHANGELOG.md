# @schemat/cli

## 0.2.1

### Patch Changes

- [#42](https://github.com/alirezahamid/schemat/pull/42) [`c74d0c8`](https://github.com/alirezahamid/schemat/commit/c74d0c88a1a279b525f263726799e278e0ed4a78) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Make every CLI suggestion copy-pasteable and stop `dev` crashing on a busy port.

  - Suggestions now carry the subcommand you ran and the `--root` you passed, so
    the monorepo hint prints `schemat dev --root apps/identity-service` instead of
    a bare `schemat --root …` that fails with `unknown option '--root'`.
  - `schemat dev` reports a clean, actionable message when the port is in use
    instead of dumping a raw Node stack trace, and `--port 0` now prints the port
    the OS actually assigned.
  - `schemat init` parses before writing `schemat.config.json`, so a failed init
    no longer leaves behind a config that breaks later commands.
  - Monorepo suggestions sort naturally (`svc2` before `svc10`) and truncate after
    10 entries.
  - TypeORM detection now recognises entities whose decorators are re-exported
    through a shared barrel, and services in a workspace where `typeorm` is
    hoisted to the root `package.json`.
  - The `--root` you pass is validated up front, so a typo reports the bad path
    instead of the misleading "no schema found".
  - `schemat dev` rejects a non-numeric `--port` with a message naming the flag,
    and Prisma parse failures name the schema that failed before the raw `P1012`
    text.
  - `schemat export` prints an absolute output path when the relative one would
    climb out of the working directory.

- [#45](https://github.com/alirezahamid/schemat/pull/45) [`8a35732`](https://github.com/alirezahamid/schemat/commit/8a357327f7edf88f833d86607379ee0661c39a56) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Give the CLI colour, symbols and a readable visual hierarchy — presentation only, no behaviour change.

  - Success, warning and error states share one symbol and colour vocabulary
    across every command, so `snapshot`, `init`, `check`, `diff`, `export` and
    `dev` no longer each invent their own prefix.
  - `check` and `diff` colour additions green, removals red and modifications
    yellow, on top of the renderer's existing `+`/`-`/`~` markers. The renderer
    still emits plain text; the CLI styles it as a post-processing pass.
  - `snapshot` and `export` lead with the path written and drop counts to a muted
    second line, with correct singular/plural (`1 relation`, not `1 relations`).
  - `dev` prints a calm startup banner with the URL and watch root, then one line
    per rebuild instead of per-file noise.
  - Errors are structured as headline, detail, then suggestion — including
    multi-line messages from an underlying parser, which are no longer bolded as
    a single wall of text.
  - Colour is decided per stream, so redirecting stdout does not change how stderr
    is styled. `NO_COLOR` (any value), `FORCE_COLOR` (including `0`) and
    `TERM=dumb` are all honoured, and symbols fall back to ASCII outside a UTF-8
    locale.
  - `--format json` and `--format markdown` stay byte-clean even when colour is
    forced on, and copy-pasteable `schemat …` suggestions never carry escape
    sequences, so pasting one from coloured output runs verbatim.

- Updated dependencies [[`c74d0c8`](https://github.com/alirezahamid/schemat/commit/c74d0c88a1a279b525f263726799e278e0ed4a78), [`f2cb384`](https://github.com/alirezahamid/schemat/commit/f2cb384d13a7d0219ad1add60d832831e67bf013)]:
  - @schemat/render@0.2.1
  - @schemat/parser-typeorm@0.2.1
  - @schemat/parser-prisma@0.2.1
  - @schemat/web@0.2.1
  - @schemat/core@0.2.1
  - @schemat/parser-dbml@0.2.1
  - @schemat/parser-drizzle@0.2.1
  - @schemat/parser-mikroorm@0.2.1
  - @schemat/parser-mongoose@0.2.1
  - @schemat/parser-sequelize@0.2.1
  - @schemat/parser-sql@0.2.1

## 0.2.0

### Minor Changes

- [#36](https://github.com/alirezahamid/schemat/pull/36) [`1039c94`](https://github.com/alirezahamid/schemat/commit/1039c94f616692ba32a699f074891e09aa687979) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Canonical types, composite PKs, and IR fidelity.

  IR_VERSION bumps to 2: closed CanonicalType vocabulary, Column.rawType + isList, differ compares canonical type only. Prisma @@id composite PKs, SQL schema.table names, TypeORM JoinColumn/optional/type fallback.

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

- [#39](https://github.com/alirezahamid/schemat/pull/39) [`9d0c3d8`](https://github.com/alirezahamid/schemat/commit/9d0c3d8c09b8ea3c312f7fe7922d5ce516463dfd) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Add a Sequelize parser (`@schemat/parser-sequelize`) and third-party parser
  loading.

  - **Sequelize parser.** Reads `sequelize.define(...)` and `Model.init(...)`
    models by statically parsing the TypeScript/JavaScript (via `ts-morph`) — no
    database connection, no code execution. Maps attributes to columns
    (type/primaryKey/allowNull/unique/defaultValue) and `belongsTo` / `hasMany` /
    `hasOne` / `belongsToMany` to relations with cardinality. Registered in the
    CLI's detection order (after mongoose, before dbml/sql), and selectable with
    `--source sequelize`.
  - **Plugin parsers.** `parsers` in `schemat.config.json` loads parsers by npm
    package name or project-relative path, so a schema source can ship outside
    this repo. Loading failures are reported as diagnostics instead of crashing
    the command.
  - Both emit IR v2 (canonical type vocabulary, `rawType`, `isList`). A
    125-table SQL fixture and the `pnpm perf:large-schema` smoke benchmark back
    the canvas numbers in `docs/perf-canvas.md`.

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

- [#34](https://github.com/alirezahamid/schemat/pull/34) [`bffb37e`](https://github.com/alirezahamid/schemat/commit/bffb37e090d1d44a773ae361bed554bedaa4c32b) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Add `--source` CLI flag, `schemat.config.json` / `.schematrc.json` config, and
  `schemat init`. Detection order is now specific sources first (prisma, drizzle,
  typeorm, mikroorm, mongoose, dbml) with SQL last; loose root `*.sql` only
  detects when the file contains CREATE TABLE. Precedence: CLI `--source` >
  config `source` > auto-detect.

### Patch Changes

- Updated dependencies [[`1039c94`](https://github.com/alirezahamid/schemat/commit/1039c94f616692ba32a699f074891e09aa687979), [`95f5cff`](https://github.com/alirezahamid/schemat/commit/95f5cfff55ad964080848c1ba8574efc1213465b), [`8e8c45f`](https://github.com/alirezahamid/schemat/commit/8e8c45fd519fbfe7c718436bd002aa9e40d9c683), [`f90c069`](https://github.com/alirezahamid/schemat/commit/f90c069ea15e98427440a45f687a8323e41afa17), [`287562a`](https://github.com/alirezahamid/schemat/commit/287562af033f237a13ce8d25c6120f91b38064a9), [`9d0c3d8`](https://github.com/alirezahamid/schemat/commit/9d0c3d8c09b8ea3c312f7fe7922d5ce516463dfd), [`e90a7b0`](https://github.com/alirezahamid/schemat/commit/e90a7b03a0a15f50a7dcf53de4d713e3aaaf4d51), [`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481), [`bffb37e`](https://github.com/alirezahamid/schemat/commit/bffb37e090d1d44a773ae361bed554bedaa4c32b)]:
  - @schemat/core@0.2.0
  - @schemat/parser-prisma@0.2.0
  - @schemat/parser-sql@0.2.0
  - @schemat/render@0.2.0
  - @schemat/web@0.2.0
  - @schemat/parser-typeorm@0.2.0
  - @schemat/parser-drizzle@0.2.0
  - @schemat/parser-dbml@0.2.0
  - @schemat/parser-mikroorm@0.2.0
  - @schemat/parser-mongoose@0.2.0
  - @schemat/parser-sequelize@0.2.0
