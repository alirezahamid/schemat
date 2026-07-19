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

- **Git-native.** Your schema source (Prisma, SQL, DBML, Drizzle, TypeORM, and MikroORM today; more later) is the single source of truth. The diagram follows the repo.
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

## Commands

```bash
schemat dev       # serve a live, auto-reloading ER diagram (http://localhost:5173)
schemat export    # write a static schema.svg or schema.mmd (Mermaid) — commit it
schemat snapshot  # write .schemat/schema.snapshot.json (commit it for drift checks)
schemat check     # fail if the live schema drifted from the snapshot (for CI)
schemat diff a b  # structural diff between two schema sources (dirs or .prisma/.sql files)
```

Each takes `-r, --root <dir>` (defaults to `.`). See `schemat <command> --help`.

### Drift check in CI

Snapshot your schema and commit it, then gate PRs with the bundled Action:

```yaml
# .github/workflows/schema-drift.yml
- uses: alirezahamid/schemat@v0
  with:
    root: "."
```

It comments the diff on the PR and fails the job when docs are stale. See
[`examples/github-workflow/schema-drift.yml`](./examples/github-workflow/schema-drift.yml).

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
| [`@schemat/render`](./packages/render) | Headless SVG + Mermaid export and diff rendering. |
| [`@schemat/web`](./packages/web) | Vite + React + React Flow canvas. |
| [`@schemat/cli`](./packages/cli) | The `schemat` CLI: dev, export, snapshot, check, diff. |

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
