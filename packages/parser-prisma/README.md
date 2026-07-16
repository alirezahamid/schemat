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

## License

MIT © Ali Reza Hamid
