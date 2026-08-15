# @schemat/parser-prisma

Prisma parser for [Schemat](https://github.com/alirezahamid/schemat): turns a
Prisma schema into the canonical Schemat IR via the `@prisma/internals` DMMF.

## Install

```bash
npm i @schemat/parser-prisma
```

## Usage

```ts
import { prismaParser } from "@schemat/parser-prisma";

// Detect + parse a project's prisma/schema.prisma into an IRSchema:
const ir = await prismaParser.parse({ projectPath: "." });

// Or point at a specific file:
const ir2 = await prismaParser.parse({ projectPath: ".", files: ["prisma/schema.prisma"] });
```

`prismaParser` implements the `SchemaParser` interface (`detect` + `parse`) from
[`@schemat/core`](https://www.npmjs.com/package/@schemat/core) and returns an `IRSchema`.

## Limitations (v1)

- **Prisma validation still applies**, with one relaxation: a `datasource`
  without a static `url` gets a placeholder injected so the schema validates.
  Schemat never connects to a database, and the placeholder is never used. Other
  validation errors (unknown blocks, bad types) still fail the parse.
- **Indexes and constraints beyond keys are not represented.** `@@index`,
  `@@map` targets other than table names, and `@@unique` are read only to refine
  relation cardinality — they do not become IR objects of their own.
- **Implicit many-to-many relations** are emitted as a single `many-to-many`
  edge without the join table Prisma creates under the hood.
- **Multi-file schemas** (`prisma/schema/*.prisma`) are concatenated before
  parsing, so a name declared twice across files is a parse error, exactly as
  Prisma would report it.


## License

MIT © Ali Reza Hamid
