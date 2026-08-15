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
