# @schemat/core

## 0.2.0

### Minor Changes

- [#36](https://github.com/alirezahamid/schemat/pull/36) [`1039c94`](https://github.com/alirezahamid/schemat/commit/1039c94f616692ba32a699f074891e09aa687979) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Canonical types, composite PKs, and IR fidelity.

  IR_VERSION bumps to 2: closed CanonicalType vocabulary, Column.rawType + isList, differ compares canonical type only. Prisma @@id composite PKs, SQL schema.table names, TypeORM JoinColumn/optional/type fallback.

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

- [#17](https://github.com/alirezahamid/schemat/pull/17) [`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Real-world Prisma robustness: parse schemas that don't statically validate but that Schemat can still render (it never connects to a database).

  - **Datasource without a static `url`** (e.g. `directUrl`-only, or url supplied at runtime) no longer errors with `Argument "url" is missing`. A harmless placeholder url is injected before validation and never used.
  - **Multi-file schemas** (`prismaSchemaFolder`: `prisma/schema/*.prisma`) are now detected and parsed — all files are concatenated.
  - **Monorepo discovery**: when no schema is found at the root, Schemat now scans `apps/*`, `packages/*`, `services/*`, `libs/*` and lists the sub-projects that contain a schema, telling you exactly which `--root` to pass.

  Verified against 7 large public schemas (cal.com 102 tables, dub 82, trigger.dev 77, langfuse 71, documenso 51, formbricks 49, umami 18).
