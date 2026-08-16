---
title: Source detection and overrides
description: How Schemat picks a parser, and how to override it per command or per project.
---

Auto-detect walks parsers **first-match-wins** in this order (specific → weak):

1. **prisma** — `prisma/schema.prisma` or `prisma/schema/*.prisma`
2. **drizzle** — `drizzle-orm` dep / `drizzle.config.*` + schema file, or a `pgTable`/`mysqlTable`/`sqliteTable` call
3. **typeorm** — `typeorm` dep, or `@Entity` + `from 'typeorm'`
4. **mikroorm** — `@mikro-orm/*` dep, or `@Entity` + `@mikro-orm/core` import
5. **mongoose** — mongoose models with `new Schema({...})`
6. **sequelize** — `sequelize` dep, or `sequelize.define` / `Model.init` model files
7. **dbml** — `schema.dbml` (and other conventional DBML paths)
8. **sql** — `schema.sql` / `db/schema.sql` / `sql/schema.sql`, or a root `*.sql` that actually contains `CREATE TABLE` (a bare `seed.sql` of INSERTs does **not** claim the project)

When several signals coexist (e.g. a Drizzle app with a root `seed.sql`), the more specific parser wins. Override when you need to:

```bash
# force a parser for one command
schemat snapshot --source drizzle
schemat check --source drizzle
schemat dev --source typeorm
```

Or pin it in the project with a config file at the root:

```json
// schemat.config.json  (or .schematrc.json)
{
  "source": "drizzle"
}
```

**Precedence:** CLI `--source` > config file `source` > auto-detect.

`schemat.config.json` is preferred over `.schematrc.json` when both exist.

## Custom parsers

Built-in parsers cover the common ORMs. To load a third-party or local parser without a monorepo PR, add `parsers` to `schemat.config.json`:

```json
{
  "parsers": ["./my-parser.js", "@org/schemat-parser-foo"],
  "source": "my-source"
}
```

Each entry is an npm package name or a path relative to the project root implementing the `SchemaParser` contract (`name` + `detect()` + `parse()`, optional `watchTargets()`). See [Writing a parser](/guides/writing-a-parser/).
