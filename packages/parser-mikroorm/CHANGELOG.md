# @schemat/parser-mikroorm

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481)]:
  - @schemat/core@0.2.0
