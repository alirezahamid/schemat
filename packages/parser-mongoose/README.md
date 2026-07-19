# @schemat/parser-mongoose

Mongoose parser for [Schemat](https://github.com/alirezahamid/schemat): turns
Mongoose schema definitions into the canonical Schemat IR by **statically parsing
the source** (via `ts-morph`) — it never connects to MongoDB, imports your app,
or runs your code.

> **MongoDB is schemaless at the database level.** This parser reads the
> *application-level* Mongoose schema (a logical model in code), not a physical
> database schema. "Tables" are Mongoose models/collections; "relations" are
> derived from `ref` conventions, not enforced foreign keys.

## Install

```bash
npm i @schemat/parser-mongoose
```

## Usage

```ts
import { mongooseParser } from "@schemat/parser-mongoose";

const ir = await mongooseParser.parse({ projectPath: "." });

// Or point at specific model files:
const ir2 = await mongooseParser.parse({ projectPath: ".", files: ["src/models/user.ts"] });
```

`mongooseParser` implements the `SchemaParser` interface (`detect` + `parse`)
from [`@schemat/core`](https://www.npmjs.com/package/@schemat/core) and returns
an `IRSchema`.

## Detection

Detects a Mongoose project when any of these hold:

- `mongoose` is a dependency in `package.json`, or
- a source file contains `new Schema(` / `new mongoose.Schema(`, or
- a `models/*` file imports mongoose.

## What it maps

- **`new Schema({...})` + `model('Name', schema)`** → tables (named after the
  model; falls back to the schema variable name when no `model()` call links it)
- Every model gets an implicit **`_id` ObjectId primary key** (matching Mongoose)
- **Fields** (shorthand `age: Number` and options-object `{ type, required,
  unique, default, enum, ref }`) → columns; `required` → not-null, `unique`,
  `default`
- **`enum: ['a','b']`** on a String field → an enum named `<Model>_<field>`
- **`{ type: ObjectId, ref: 'Other' }`** → a `one-to-many` relation
  (`fromColumns: [field]`, `toColumns: ['_id']`); an **array of refs**
  (`[{ type: ObjectId, ref }]`) → `many-to-many`

## Limitations (v1)

- **Nested subdocuments** (inline object fields like `address: { city: String }`)
  are collapsed to a single `Object` column — not recursed into separate tables.
- Arrays of primitives collapse to an `Array` column.
- `ref` targets are matched by model name; a ref to a model not present in the
  parsed files still emits the edge (Mongo doesn't enforce FKs).

## License

MIT © Ali Reza Hamid
