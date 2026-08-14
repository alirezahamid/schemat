# Immutable real-world dump evidence

Two independent public PostgreSQL dumps are used as evidence. Both are pinned to
immutable commit SHAs so the numbers below can be reproduced exactly.

## Prerequisite

The parser imports `@schemat/core`, so that workspace package must be built once
before any snippet below will run:

```sh
pnpm --filter @schemat/core build
```

Both snippets compile into `packages/parser-sql/.evidence/` (git-ignored) rather
than a directory outside the package, so the `@schemat/core` workspace
dependency resolves at import time.

## 1. maccman/monocle — dump-style `ALTER TABLE` constraints

- Repository: https://github.com/maccman/monocle
- Commit: `793f00fad23d3f84cf945f84fceacc4796bf5bf7`
- File: `db/schema.sql`
- Immutable URL: https://raw.githubusercontent.com/maccman/monocle/793f00fad23d3f84cf945f84fceacc4796bf5bf7/db/schema.sql

The file is a complete 765-line PostgreSQL dump-style schema. It contains separate `ALTER TABLE ONLY ... ADD CONSTRAINT` primary-key, unique, and foreign-key statements.

Reproduction from the repository root:

```sh
pnpm --filter @schemat/core build

curl -fsSL https://raw.githubusercontent.com/maccman/monocle/793f00fad23d3f84cf945f84fceacc4796bf5bf7/db/schema.sql \
  -o /tmp/monocle-schema.sql

mkdir -p packages/parser-sql/.evidence
git show origin/main:packages/parser-sql/src/index.ts > packages/parser-sql/.evidence/main-parser.ts
cp packages/parser-sql/src/index.ts packages/parser-sql/.evidence/branch-parser.ts

cd packages/parser-sql
./node_modules/.bin/tsup .evidence/main-parser.ts .evidence/branch-parser.ts \
  --format esm --out-dir .evidence/dist

node -e '
const { readFileSync } = require("node:fs");
(async () => {
  for (const rev of ["main", "branch"]) {
    const { parseSql } = await import("./.evidence/dist/" + rev + "-parser.js");
    const ir = parseSql(readFileSync("/tmp/monocle-schema.sql", "utf8"));
    const columns = ir.tables.flatMap((table) => table.columns);
    console.log(rev, JSON.stringify({
      tables: ir.tables.length,
      primaryKeyColumns: columns.filter((column) => column.isPrimaryKey).length,
      uniqueColumns: columns.filter((column) => column.isUnique).length,
      relations: ir.relations.length,
    }));
  }
})()'
```

Results:

| Revision | Tables | PK-marked columns | Unique-marked columns | Relations |
| --- | ---: | ---: | ---: | ---: |
| `origin/main` (`a689fb6`) | 8 | 0 | 0 | 0 |
| PR branch | 8 | 7 | 7 | 13 |

The unchanged table count isolates the effect: supported dump constraints are now applied rather than silently discarded.

## 2. derrickreimer/level — `key` as a real column name

- Repository: https://github.com/derrickreimer/level
- Commit: `98b655829f10cc54c5829cc543a71453839aa42c`
- File: `priv/repo/structure.sql`
- Immutable URL: https://raw.githubusercontent.com/derrickreimer/level/98b655829f10cc54c5829cc543a71453839aa42c/priv/repo/structure.sql

`key` and `index` are UNRESERVED keywords in PostgreSQL, so they are legal column
names. This 2290-line dump contains three such columns:

- line 393: `key text NOT NULL,` (`digests`)
- line 589: `key text NOT NULL,` (`post_locators`)
- line 923: `key character varying(255) NOT NULL,` (`tutorials`)

An earlier revision of this branch detected inline MySQL indexes by first token,
which silently deleted all three. Detection is now shape-aware: a `KEY`/`INDEX`
token only starts an index definition when it is followed by an optional index
name and a parenthesised column list.

Reproduction uses the same compiled parsers as above, with:

```sh
curl -fsSL https://raw.githubusercontent.com/derrickreimer/level/98b655829f10cc54c5829cc543a71453839aa42c/priv/repo/structure.sql \
  -o /tmp/level-structure.sql

cd packages/parser-sql
node -e '
const { readFileSync } = require("node:fs");
(async () => {
  for (const rev of ["main", "branch"]) {
    const { parseSql } = await import("./.evidence/dist/" + rev + "-parser.js");
    const ir = parseSql(readFileSync("/tmp/level-structure.sql", "utf8"));
    const columns = ir.tables.flatMap((table) => table.columns);
    const keyish = columns.filter((c) => c.name === "key" || c.name === "index");
    console.log(rev, JSON.stringify({
      tables: ir.tables.length,
      columns: columns.length,
      keyOrIndexColumns: keyish.length,
      relations: ir.relations.length,
    }));
  }
})()'
```

Results:

| Revision | Tables | Columns | `key`/`index` columns | Relations |
| --- | ---: | ---: | ---: | ---: |
| `origin/main` (`a689fb6`) | 39 | 307 | 3 | 0 |
| PR branch before the shape-aware fix (`d75d9f2`) | 39 | 304 | 0 | 92 |
| PR branch after the shape-aware fix | 39 | 307 | 3 | 92 |

The three `key` columns are restored while the dump-constraint relations gained
by this branch (0 → 92) are retained.
