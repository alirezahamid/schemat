# @schemat/parser-dbml

DBML parser for [Schemat](https://github.com/alirezahamid/schemat): turns a
[DBML](https://dbml.dbdiagram.io/) schema (the format used by dbdiagram.io) into
the canonical Schemat IR.

## Install

```bash
npm i @schemat/parser-dbml
```

## Usage

```ts
import { dbmlParser } from "@schemat/parser-dbml";

// Detect + parse a project's DBML file into an IRSchema:
const ir = await dbmlParser.parse({ projectPath: "." });

// Or point at a specific file:
const ir2 = await dbmlParser.parse({ projectPath: ".", files: ["docs/schema.dbml"] });
```

`dbmlParser` implements the `SchemaParser` interface (`detect` + `parse`) from
[`@schemat/core`](https://www.npmjs.com/package/@schemat/core) and returns an
`IRSchema`.

## Detection

The parser looks for a DBML file at (in order): `schema.dbml`, `database.dbml`,
`dbml/schema.dbml`, `docs/schema.dbml`, `db/schema.dbml`, or any `*.dbml` file in
the project root.

## What it maps

- **Tables** → tables (with table `Note` as the comment)
- **Fields** → columns (type, `pk`, `unique`, `not null`, defaults, field `note`)
- **Composite `pk` indexes** → primary-key columns
- **Enums** → enums
- **Refs** (inline `[ref: > ...]` and standalone `Ref:`) → relations, with
  cardinality inferred from the DBML relation symbols (`>` / `<` = one-to-many,
  `-` = one-to-one, `<>` = many-to-many)

## License

MIT © Ali Reza Hamid
