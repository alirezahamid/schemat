---
"@schemat/parser-mikroorm": minor
"@schemat/cli": minor
---

Add a MikroORM parser (`@schemat/parser-mikroorm`). Schemat now reads MikroORM
entity classes by statically parsing the TypeScript (via `ts-morph`) — no
database connection, no code execution. Maps `@Entity` classes to tables,
`@PrimaryKey`/`@Property` to columns (nullable/unique/default/type), `@Enum`
(identifier and inline-array forms) to enums, and relation decorators to IR
relations (`@ManyToOne` → one-to-many, `@OneToOne` → one-to-one, owning
`@ManyToMany` → many-to-many; `@OneToMany` and `mappedBy` inverse sides skipped).
Relation targets resolve from the entity class name to its real table name.
`detect()` requires a `@mikro-orm` import signal so it doesn't collide with
TypeORM's `@Entity`. Registered in the CLI's parser detection.
