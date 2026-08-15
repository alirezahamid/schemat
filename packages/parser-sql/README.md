# @schemat/parser-sql

SQL parser for [Schemat](https://github.com/alirezahamid/schemat): turns SQL DDL
(`CREATE TABLE ...`) into the canonical Schemat IR.

## Install

```bash
npm i @schemat/parser-sql
```

## Usage

```ts
import { parseSql, sqlParser } from "@schemat/parser-sql";

// Parse a raw DDL string:
const ir = parseSql("CREATE TABLE users (id INT PRIMARY KEY);");

// Or use the SchemaParser interface (detect + parse a project dir / file):
const ir2 = await sqlParser.parse({ projectPath: ".", files: ["schema.sql"] });
```

Both return an `IRSchema` from
[`@schemat/core`](https://www.npmjs.com/package/@schemat/core).

## What it maps

- **`CREATE TABLE`** → tables, columns (type, `NOT NULL`, `DEFAULT`,
  `PRIMARY KEY`, `UNIQUE`), plus inline `REFERENCES` and table-level
  `FOREIGN KEY` → relations
- **`CREATE TYPE ... AS ENUM`** (Postgres) → enums
- **`ALTER TABLE ... ADD CONSTRAINT`** → primary keys, uniques, and foreign keys
  applied back onto the tables
- **`CREATE UNIQUE INDEX`** on a single column → `isUnique`

## Limitations (v1)

- **Cardinality is always `one-to-many` for SQL foreign keys.** Uniqueness of
  the owning column is not yet used to promote an FK to `one-to-one`.
- **Composite and partial uniqueness is not represented.** A multi-column
  `UNIQUE` index, or a `CREATE UNIQUE INDEX ... WHERE ...`, does not make its
  columns individually unique, so it is deliberately dropped rather than
  overstated.
- **`CHECK` constraints are skipped** (with a warning); they have no place in
  the IR.
- **Views, functions, triggers, sequences, grants and similar statements are
  ignored on purpose.** Anything else the parser cannot read is skipped and
  summarised as one warning per statement kind, so a large dump does not
  produce thousands of lines of noise.
- Detection only claims a project from `schema.sql`, `db/schema.sql`,
  `sql/schema.sql`, or a root `*.sql` that actually contains `CREATE TABLE` — a
  `seed.sql` of INSERTs will not hijack a Drizzle or Prisma project.


## License

MIT © Ali Reza Hamid
