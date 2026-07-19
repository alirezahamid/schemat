---
"@schemat/parser-drizzle": minor
"@schemat/cli": minor
---

Add a Drizzle ORM parser (`@schemat/parser-drizzle`). Schemat now reads
[Drizzle](https://orm.drizzle.team/) schemas by statically parsing the
TypeScript (via `ts-morph`) — no database connection, no code execution. Maps
`pgTable`/`mysqlTable`/`sqliteTable`, column builders and modifiers
(`.primaryKey`/`.notNull`/`.unique`/`.default`/`.references`), and `pgEnum` into
tables, columns, enums, and relations (with cardinality). Registered in the CLI's
parser detection so `dev`/`export`/`snapshot`/`check` work on Drizzle projects.
