# @schemat/parser-sequelize

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @schemat/core@0.2.1

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`1039c94`](https://github.com/alirezahamid/schemat/commit/1039c94f616692ba32a699f074891e09aa687979), [`9d0c3d8`](https://github.com/alirezahamid/schemat/commit/9d0c3d8c09b8ea3c312f7fe7922d5ce516463dfd), [`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481)]:
  - @schemat/core@0.2.0
