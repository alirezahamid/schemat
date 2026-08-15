# @schemat/parser-sequelize

Sequelize parser for [Schemat](https://github.com/alirezahamid/schemat): turns
Sequelize models into the canonical Schemat IR by **statically parsing the
TypeScript/JavaScript** (via `ts-morph`) — it never connects to a database or
runs your code.

## Supported shapes

- `sequelize.define('Name', attributes, options)`
- `Model.init(attributes, { sequelize, modelName, tableName })`
- Associations: `belongsTo`, `hasMany`, `hasOne`, `belongsToMany`

## Install

```bash
npm i @schemat/parser-sequelize
```

## Usage

```ts
import { sequelizeParser } from "@schemat/parser-sequelize";

const result = await sequelizeParser.parse({ projectPath: "." });
// result.schema is an IRSchema; result.warnings are non-fatal diagnostics
```

## Limitations (v1)

- **Static parse only.** Attributes built at runtime — spread from a shared
  object, computed in a loop, or returned by a factory — are not visible. Only
  literal attribute objects in `sequelize.define(...)` / `Model.init(...)` are
  read.
- **Synthetic FK naming.** When an association has no explicit `foreignKey`, the
  column is assumed to be `<model>Id` targeting `id`. An unconventional naming
  strategy needs `foreignKey` spelled out.
- **`hasMany` inverse sides are skipped** so a `belongsTo`/`hasMany` pair yields
  one edge, not two.
- **`belongsToMany` emits a `many-to-many` edge without the join table**, even
  when `through` names a real model.
- Associations whose target cannot be resolved to a parsed model are skipped
  with a warning rather than emitted as a dangling edge.

## License

MIT © Ali Reza Hamid
