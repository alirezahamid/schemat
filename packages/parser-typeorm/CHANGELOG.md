# @schemat/parser-typeorm

## 0.2.0

### Minor Changes

- [#20](https://github.com/alirezahamid/schemat/pull/20) [`e90a7b0`](https://github.com/alirezahamid/schemat/commit/e90a7b03a0a15f50a7dcf53de4d713e3aaaf4d51) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Add a TypeORM parser (`@schemat/parser-typeorm`). Schemat now reads TypeORM
  entity classes by statically parsing the TypeScript (via `ts-morph`) — no
  database connection, no code execution. Maps `@Entity` classes, `@Column`
  family decorators (nullable/unique/default/type/name), `@PrimaryColumn` /
  `@PrimaryGeneratedColumn`, `@Column({ type: 'enum' })`, and relations
  (`@ManyToOne`/`@OneToOne`/`@ManyToMany`) into tables, columns, enums, and
  relations with cardinality. Relation targets referenced by class are resolved
  to the real table name. Registered in the CLI's parser detection so
  `dev`/`export`/`snapshot`/`check` work on TypeORM projects.

### Patch Changes

- Updated dependencies [[`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481)]:
  - @schemat/core@0.2.0
