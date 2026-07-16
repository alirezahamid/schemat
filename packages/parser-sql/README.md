# @schemat/parser-sql

SQL parser for [Schemat](https://github.com/alirezahamid/schemat): turns SQL DDL
(`CREATE TABLE ...`) into the canonical Schemat IR.

## Install

```bash
npm i @schemat/parser-sql
```

## Usage

```ts
import { parseSql, sqlParser } from "@schemat/parser-sql";

// Parse a raw DDL string:
const ir = parseSql("CREATE TABLE users (id INT PRIMARY KEY);");

// Or use the SchemaParser interface (detect + parse a project dir / file):
const ir2 = await sqlParser.parse({ projectPath: ".", files: ["schema.sql"] });
```

Both return an `IRSchema` from
[`@schemat/core`](https://www.npmjs.com/package/@schemat/core).

## License

MIT © Ali Reza Hamid
