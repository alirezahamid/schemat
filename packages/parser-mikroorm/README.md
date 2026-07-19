# @schemat/parser-mikroorm

MikroORM parser for [Schemat](https://github.com/alirezahamid/schemat): turns
MikroORM entity classes into the canonical Schemat IR by **statically parsing the
TypeScript** (via `ts-morph`) — it never connects to a database or runs code.

## Install

```bash
npm i @schemat/parser-mikroorm
```

## Usage

```ts
import { mikroormParser } from "@schemat/parser-mikroorm";

const ir = await mikroormParser.parse({ projectPath: "." });
```

`mikroormParser` implements the `SchemaParser` interface (`detect` + `parse`)
from [`@schemat/core`](https://www.npmjs.com/package/@schemat/core).

## Detection

Detects a MikroORM project when any of these hold:

- a `@mikro-orm/*` package is in `package.json` deps, or
- a source file imports from `@mikro-orm/core` (or any `@mikro-orm/*`).

A `@Entity` decorator alone is **not** enough — a `@mikro-orm` import signal is
required so TypeORM projects (which also use `@Entity`) aren't mis-detected.

## What it maps

- **`@Entity()` classes** → tables (name from `@Entity({ tableName })`, else the
  class name)
- **`@PrimaryKey`** → primary-key columns; **`@Property`** → columns
  (`nullable`, `unique`, `default`, `type`/`fieldName`/`name`, `comment`)
- **`@Enum(() => SomeEnum)`** → an enum resolved from the `enum` declaration;
  **`@Enum({ items: ['a','b'] })`** → a synthetic `<table>_<col>_enum`
- **Relations**: `@ManyToOne` → `one-to-many` (FK owner), `@OneToOne` (owner) →
  `one-to-one`, `@ManyToMany` (owner, no `mappedBy`) → `many-to-many`;
  `@OneToMany` and `mappedBy` inverse sides are skipped to avoid duplicate edges
- Relation targets referenced by class (`() => User`) resolve to that entity's
  real table name

## Limitations (v1)

- Synthetic FK column naming (`<property>Id` → `['id']`); explicit
  `@ManyToOne({ joinColumn })` / `referencedColumnName` and composite keys aren't
  read yet.
- Relations to a class that isn't a parsed `@Entity` are skipped rather than
  emitted as a dangling edge.
- `@Enum` values referenced from an `enum` declaration outside the parsed files
  resolve to no enum node (the column keeps the referenced type name).

## License

MIT © Ali Reza Hamid
