---
title: Writing a parser
description: Implement the SchemaParser contract and load a custom parser via config.
---

A parser turns one schema source into Schemat's canonical IR. Built-ins live in
`packages/parser-*`. Community parsers can ship as separate npm packages and be
loaded via config — no monorepo PR required.

## Contract

Implement `@schemat/core`'s `SchemaParser`:

```ts
import {
  IR_VERSION,
  type ParserInput,
  type ParserOutput,
  type SchemaParser,
} from "@schemat/core";

export const myParser: SchemaParser = {
  name: "my-source", // short stable id
  async detect(projectPath: string): Promise<boolean> {
    // true when this source is present under projectPath
    return false;
  },
  async parse(input: ParserInput): Promise<ParserOutput> {
    // return IRSchema (v2), or { schema, warnings }
    return { version: IR_VERSION, tables: [], enums: [], relations: [] };
  },
  // optional: paths whose changes should trigger re-parse in `schemat dev`
  watchTargets(projectPath: string): string[] {
    return [projectPath];
  },
};

export default myParser;
```

Rules:

- **Static only.** Do not connect to a database, import the app, or execute user
  code. Read source files and produce IR.
- **IR v2.** Schema `version` is `2` (`IR_VERSION`). Every column needs closed
  canonical `type`, plus `rawType` (source display string) and `isList`. Map
  dialect types with `mapToCanonicalType()` from `@schemat/core`. See
  [IR v2 migration](/reference/ir-v2-migration/).
- **Validate.** Hand the object through `parseSchema(...)` from `@schemat/core`
  before returning so bad IR fails fast.
- **Warnings, not throws** for recoverable gaps (unsupported constructs). Put
  fatal problems in thrown errors.
- Export the parser as **default** and/or a named export that is a
  `SchemaParser` object (`name` + `detect` + `parse`).

## Loading via config

In the project root, create `schemat.config.json`:

```json
{
  "parsers": ["./parsers/my-parser.js", "@org/schemat-parser-foo"],
  "source": "my-source"
}
```

| Field | Meaning |
| --- | --- |
| `parsers` | Array of npm package names or paths relative to the project root. Loaded dynamically and merged with built-ins (plugin wins on name clash). |
| `source` | Optional. Pin detection to this parser `name` only. |

Built-in names today: `prisma`, `sql`, `dbml`, `drizzle`, `typeorm`, `mikroorm`,
`mongoose`, `sequelize`.

## Minimal package layout

```
schemat-parser-foo/
  package.json          # "type": "module", main/exports -> dist
  src/index.ts          # implements SchemaParser
  dist/index.js
```

Depend on `@schemat/core` for types and `parseSchema`. Publish under any scope;
users add the package name to `parsers`.

## Verify locally

```bash
# from a fixture project that has schemat.config.json pointing at your package
npx @schemat/cli export --root . -f mermaid -o /tmp/out.mmd
```
