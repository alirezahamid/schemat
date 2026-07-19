---
"@schemat/parser-typeorm": minor
"@schemat/cli": minor
---

Add a TypeORM parser (`@schemat/parser-typeorm`). Schemat now reads TypeORM
entity classes by statically parsing the TypeScript (via `ts-morph`) — no
database connection, no code execution. Maps `@Entity` classes, `@Column`
family decorators (nullable/unique/default/type/name), `@PrimaryColumn` /
`@PrimaryGeneratedColumn`, `@Column({ type: 'enum' })`, and relations
(`@ManyToOne`/`@OneToOne`/`@ManyToMany`) into tables, columns, enums, and
relations with cardinality. Relation targets referenced by class are resolved
to the real table name. Registered in the CLI's parser detection so
`dev`/`export`/`snapshot`/`check` work on TypeORM projects.
