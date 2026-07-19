# @schemat/parser-drizzle

Drizzle ORM parser for [Schemat](https://github.com/alirezahamid/schemat): turns
a [Drizzle](https://orm.drizzle.team/) schema into the canonical Schemat IR by
**statically parsing the TypeScript** (via `ts-morph`) — it never connects to a
database or runs your code.

## Install

```bash
npm i @schemat/parser-drizzle
```

## Usage

```ts
import { drizzleParser } from "@schemat/parser-drizzle";

const ir = await drizzleParser.parse({ projectPath: "." });

// Or point at specific schema files:
const ir2 = await drizzleParser.parse({ projectPath: ".", files: ["src/db/schema.ts"] });
```

`drizzleParser` implements the `SchemaParser` interface (`detect` + `parse`) from
[`@schemat/core`](https://www.npmjs.com/package/@schemat/core) and returns an
`IRSchema`.

## Detection

Detects a Drizzle project when any of these hold:

- a `drizzle.config.ts` / `drizzle.config.json` exists, or
- `drizzle-orm` is a dependency **and** a schema file is present, or
- a conventional schema file exists (`src/schema.ts`, `src/db/schema.ts`,
  `db/schema.ts`, `drizzle/schema.ts`, `src/drizzle/schema.ts`).

## What it maps

- **`pgTable` / `mysqlTable` / `sqliteTable`** → tables (name from the first
  string arg; column name from the builder's first arg, else the property key)
- **Column builders** (`serial`, `varchar`, `integer`, …) → column types
- **`.primaryKey()` / `.notNull()` / `.unique()` / `.default(...)` /
  `.defaultNow()`** → column flags and defaults
- **`.references(() => table.col)`** → relations; cardinality is `one-to-one`
  when the owning column is `unique`/`primaryKey`, else `one-to-many`
- **`pgEnum('name', [...])`** → enums

Because it's a static parse, a syntactically broken file yields whatever tables
resolved cleanly rather than throwing.

## License

MIT © Ali Reza Hamid
