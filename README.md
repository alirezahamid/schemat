# Schemat

<p align="center">
  <a href="https://www.npmjs.com/package/@schemat/cli"><img src="https://img.shields.io/npm/v/@schemat/cli.svg" alt="npm version"></a>
  <a href="https://github.com/alirezahamid/schemat/actions/workflows/ci.yml"><img src="https://github.com/alirezahamid/schemat/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@schemat/cli.svg" alt="license"></a>
  <img src="https://img.shields.io/node/v/@schemat/cli.svg" alt="node version">
</p>

> Git-native database schema documentation. Point it at your repo, get a live, interactive ER diagram in the browser.

Schemat is an open-source, local-first tool for documenting database schemas — like [dbdiagram.io](https://dbdiagram.io), but your schema lives in git and the diagram is a derived view. Edit your schema in your editor, watch the diagram update live in the browser. No cloud, no account, no lock-in.

## Why

- **Git-native.** Your schema source (Prisma, SQL, DBML, Drizzle, TypeORM, MikroORM, Mongoose, and Sequelize today; community parsers via config) is the single source of truth. The diagram follows the repo.
- **Local-first.** Runs entirely on your machine. Nothing leaves your laptop.
- **Live.** `schemat dev` watches your schema files and pushes changes to an interactive canvas over WebSocket — edit, save, see it instantly.
- **CI-ready.** `schemat check` fails your build when the committed schema docs drift from the live schema. Ships with a GitHub Action.
- **Modular.** A small canonical IR sits between pluggable parsers and the renderer. Adding a new schema source is a new package, not a rewrite.

## Status

Early. v1 is **read-only**: the repo is the source of truth and the browser renders it. In-browser editing is a future milestone.

## Install

```bash
# one-off
npx @schemat/cli dev

# or install the CLI globally
npm i -g @schemat/cli
schemat dev
```

## Quick start

```bash
# from a repo that already has a Prisma / Drizzle / TypeORM / … schema
schemat init
# → writes schemat.config.json, takes an initial .schemat/schema.snapshot.json
# → prints next steps (commit, add check to CI, run dev)

schemat dev       # live ER diagram
schemat check     # CI drift gate (after you've committed the snapshot)
```

## Commands

```bash
schemat init      # detect source, write config, take initial snapshot
schemat dev       # serve a live, auto-reloading ER diagram (http://localhost:5173)
schemat export    # write a static schema.svg or schema.mmd (Mermaid) — commit it
schemat snapshot  # write .schemat/schema.snapshot.json (commit it for drift checks)
schemat check     # fail if the live schema drifted from the snapshot (for CI)
schemat diff a b  # structural diff between two schema sources (dirs or .prisma/.sql files)
```

Common flags (see `schemat <command> --help`):

- `-r, --root <dir>` — project root (default `.`)
- `-s, --source <parser>` — force a parser, bypassing auto-detect
  (`prisma | drizzle | typeorm | mikroorm | mongoose | sequelize | dbml | sql`)

### Source detection and overrides

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

### `schemat init`

Onboarding in one command:

```text
$ schemat init
  ✓ Wrote schemat.config.json (source: prisma)
  ✓ Snapshot written: 3 tables, 2 relations, 0 enums → .schemat/schema.snapshot.json

Next steps:
  1. Commit schemat.config.json and .schemat/schema.snapshot.json
  2. Add `schemat check` to CI (see the GitHub Action in the README)
  3. Run `schemat dev` for a live ER diagram
```

Flags: `--source <parser>` when detection is wrong or ambiguous, `--force` to overwrite an existing config.

### Drift check in CI

Snapshot your schema and commit it, then gate PRs with the bundled Action:

```yaml
# .github/workflows/schema-drift.yml
- uses: alirezahamid/schemat@main
  with:
    root: "."
```

The moving `v0` tag does not exist yet — it is created with the next release.
Until then pin `@main` (or a commit SHA, which is what you want in a
security-sensitive repo anyway).

It comments the diff on the PR and fails the job when docs are stale. See
[`examples/github-workflow/schema-drift.yml`](./examples/github-workflow/schema-drift.yml).

Recommended flow: `schemat init` once locally → commit config + snapshot → run
`schemat check` (or the Action) in CI.

## Custom parsers

Built-in parsers cover the common ORMs. To load a third-party or local parser without a monorepo PR, add `parsers` to `schemat.config.json`:

```json
{
  "parsers": ["./my-parser.js", "@org/schemat-parser-foo"],
  "source": "my-source"
}
```

Each entry is an npm package name or a path relative to the project root implementing the `SchemaParser` contract (`name` + `detect()` + `parse()`, optional `watchTargets()`). See [docs/writing-a-parser.md](./docs/writing-a-parser.md).

## Architecture

```
schema source ─→ [parser] ─→ IR (canonical, zod-validated) ─→ [server: watch + WebSocket] ─→ [React Flow canvas]
                                 └─→ [differ] ─→ snapshot / check / diff (schema-drift CI)
```

Monorepo packages (all published under the [`@schemat`](https://www.npmjs.com/org/schemat) org):

| Package | Role |
|---|---|
| [`@schemat/core`](./packages/core) | IR types, parser interface, differ. Zero parser dependencies. |
| [`@schemat/parser-prisma`](./packages/parser-prisma) | Prisma → IR (via `@prisma/internals` DMMF). |
| [`@schemat/parser-sql`](./packages/parser-sql) | SQL DDL → IR. |
| [`@schemat/parser-dbml`](./packages/parser-dbml) | DBML (dbdiagram.io) → IR. |
| [`@schemat/parser-drizzle`](./packages/parser-drizzle) | Drizzle ORM (static TS AST) → IR. |
| [`@schemat/parser-typeorm`](./packages/parser-typeorm) | TypeORM entities (static TS AST) → IR. |
| [`@schemat/parser-mikroorm`](./packages/parser-mikroorm) | MikroORM entities (static TS AST) → IR. |
| [`@schemat/parser-mongoose`](./packages/parser-mongoose) | Mongoose schemas (static TS AST) → IR. |
| [`@schemat/parser-sequelize`](./packages/parser-sequelize) | Sequelize models (`define` / `Model.init`, static AST) → IR. |
| [`@schemat/render`](./packages/render) | Headless SVG + Mermaid export and diff rendering. |
| [`@schemat/web`](./packages/web) | Vite + React + React Flow canvas. |
| [`@schemat/cli`](./packages/cli) | The `schemat` CLI: init, dev, export, snapshot, check, diff. |

## Large-schema canvas fixture

Stress fixture for canvas layout (≥100 tables + FKs):

- `examples/large-schema/` — committed SQL + [README](./examples/large-schema/README.md)
- Writeup: [docs/perf-canvas.md](./docs/perf-canvas.md)

```bash
pnpm install && pnpm build
pnpm perf:large-schema:generate   # optional regenerate
pnpm perf:large-schema            # parse + headless ELK timings (JSON)
# interactive canvas:
pnpm --filter @schemat/cli exec tsx src/index.ts dev --root examples/large-schema --source sql
```

## Contributing

Contributions welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md). Quick start:

```bash
pnpm install
pnpm build
pnpm test
pnpm dev          # run the CLI against examples/blog
```

Requires **Node >= 22** and **pnpm 9**. Every user-facing change needs a
[changeset](./CONTRIBUTING.md#changesets--required-for-user-facing-changes).

## License

MIT © Ali Reza Hamid
