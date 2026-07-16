# @schemat/core

Core of [Schemat](https://github.com/alirezahamid/schemat): the canonical schema
**IR** (intermediate representation), the `SchemaParser` interface that parsers
implement, and the structural **differ**.

This package has zero parser dependencies — it defines the shared contract that
`@schemat/parser-prisma`, `@schemat/parser-sql`, and `@schemat/render` build on.

## Install

```bash
npm i @schemat/core
```

## Usage

```ts
import { diff, IR_VERSION, type IRSchema, type SchemaChange } from "@schemat/core";

const changes: SchemaChange[] = diff(before, after); // structural delta between two IRSchema
```

## License

MIT © Ali Reza Hamid
