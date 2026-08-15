---
"@schemat/parser-sequelize": minor
"@schemat/cli": minor
"@schemat/core": minor
---

Add a Sequelize parser (`@schemat/parser-sequelize`) and third-party parser
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
