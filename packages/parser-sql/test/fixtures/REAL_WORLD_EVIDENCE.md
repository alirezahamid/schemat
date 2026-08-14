# Immutable PostgreSQL dump evidence

Source:

- Repository: https://github.com/maccman/monocle
- Commit: `793f00fad23d3f84cf945f84fceacc4796bf5bf7`
- File: `db/schema.sql`
- Immutable URL: https://raw.githubusercontent.com/maccman/monocle/793f00fad23d3f84cf945f84fceacc4796bf5bf7/db/schema.sql

The file is a complete 765-line PostgreSQL dump-style schema. It contains separate `ALTER TABLE ONLY ... ADD CONSTRAINT` primary-key, unique, and foreign-key statements.

Reproduction from the repository root:

```sh
curl -fsSL https://raw.githubusercontent.com/maccman/monocle/793f00fad23d3f84cf945f84fceacc4796bf5bf7/db/schema.sql -o /tmp/monocle-schema.sql
git show origin/main:packages/parser-sql/src/index.ts > /tmp/main-parser.ts
cp packages/parser-sql/src/index.ts /tmp/branch-parser.ts
packages/parser-sql/node_modules/.bin/tsup /tmp/main-parser.ts --format esm --out-dir /tmp/main-dist --external @schemat/core
packages/parser-sql/node_modules/.bin/tsup /tmp/branch-parser.ts --format esm --out-dir /tmp/branch-dist --external @schemat/core
```

Each compiled parser was imported from a temporary directory under `packages/parser-sql` (so the workspace dependency resolves), passed the exact same `/tmp/monocle-schema.sql`, and counted with:

```js
const columns = ir.tables.flatMap((table) => table.columns);
({
  tables: ir.tables.length,
  primaryKeyColumns: columns.filter((column) => column.isPrimaryKey).length,
  uniqueColumns: columns.filter((column) => column.isUnique).length,
  relations: ir.relations.length,
});
```

Results:

| Revision | Tables | PK-marked columns | Unique-marked columns | Relations |
| --- | ---: | ---: | ---: | ---: |
| `origin/main` (`a689fb6`) | 8 | 0 | 0 | 0 |
| PR branch (checkpoint `0ab6fe17c6707067d2e7ea440c1fbf40cd0e939e`) | 8 | 7 | 7 | 13 |

The unchanged table count isolates the effect: supported dump constraints are now applied rather than silently discarded.
