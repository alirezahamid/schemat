# @schemat/parser-drizzle

## 0.2.0

### Minor Changes

- [#19](https://github.com/alirezahamid/schemat/pull/19) [`8e8c45f`](https://github.com/alirezahamid/schemat/commit/8e8c45fd519fbfe7c718436bd002aa9e40d9c683) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Add a Drizzle ORM parser (`@schemat/parser-drizzle`). Schemat now reads
  [Drizzle](https://orm.drizzle.team/) schemas by statically parsing the
  TypeScript (via `ts-morph`) — no database connection, no code execution. Maps
  `pgTable`/`mysqlTable`/`sqliteTable`, column builders and modifiers
  (`.primaryKey`/`.notNull`/`.unique`/`.default`/`.references`), and `pgEnum` into
  tables, columns, enums, and relations (with cardinality). Registered in the CLI's
  parser detection so `dev`/`export`/`snapshot`/`check` work on Drizzle projects.

### Patch Changes

- Updated dependencies [[`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481)]:
  - @schemat/core@0.2.0
