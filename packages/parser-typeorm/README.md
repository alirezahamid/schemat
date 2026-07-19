# @schemat/parser-typeorm

TypeORM parser for [Schemat](https://github.com/alirezahamid/schemat): turns
TypeORM entity classes into the canonical Schemat IR by **statically parsing the
TypeScript** (via `ts-morph`) — it never connects to a database or runs your
code.

## Install

```bash
npm i @schemat/parser-typeorm
```

## Usage

```ts
import { typeormParser } from "@schemat/parser-typeorm";

const ir = await typeormParser.parse({ projectPath: "." });

// Or point at specific entity files:
const ir2 = await typeormParser.parse({ projectPath: ".", files: ["src/user.entity.ts"] });
```

`typeormParser` implements the `SchemaParser` interface (`detect` + `parse`) from
[`@schemat/core`](https://www.npmjs.com/package/@schemat/core) and returns an
`IRSchema`.

## Detection

Detects a TypeORM project when any of these hold:

- `typeorm` is a dependency in `package.json`, or
- a `*.entity.ts` file exists, or
- any `.ts` file contains an `@Entity(` decorator.

## What it maps

- **`@Entity('name')` classes** → tables (name from the decorator arg / `name`
  option, else the class name)
- **`@Column` / `@PrimaryColumn` / `@PrimaryGeneratedColumn` /
  `@CreateDateColumn` / …** → columns; reads `nullable`, `unique`, `default`,
  `type`, `name`/`fieldName`, `length`
- **`@PrimaryColumn` / `@PrimaryGeneratedColumn`** → primary keys
  (`@PrimaryGeneratedColumn('uuid')` → `uuid` type)
- **`@Column({ type: 'enum', enum: … })`** → enums (identifier enums are
  resolved from `enum X {}` declarations; inline arrays get a synthetic
  `<table>_<col>_enum` name)
- **Relations** → `@ManyToOne`/`@OneToOne` = the FK-owning side (mapped to
  `one-to-many` / `one-to-one`); `@ManyToMany` + `@JoinTable` = `many-to-many`;
  `@OneToMany` is skipped (it's the inverse of a `@ManyToOne`, avoiding a
  duplicate edge). Relation targets referenced by class (`() => User`) are
  resolved to that entity's real table name.

## Limitations (v1)

- **Synthetic FK columns.** TypeORM doesn't always name the join column in the
  decorator, so a relation's `fromColumns` uses the `<property>Id` convention and
  `toColumns` defaults to `['id']`. Explicit `@JoinColumn({ name })` overrides
  aren't read yet.
- Column type falls back to the property's TS type when no `type` option is
  given (`number`, `string`, `boolean`, `Date`→`timestamp`).

## License

MIT © Ali Reza Hamid
