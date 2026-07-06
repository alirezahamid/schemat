# Schemat

> Git-native database schema documentation. Point it at your repo, get a live, interactive ER diagram in the browser.

Schemat is an open-source, local-first tool for documenting database schemas — like [dbdiagram.io](https://dbdiagram.io), but your schema lives in git and the diagram is a derived view. Edit your schema in your editor, watch the diagram update live in the browser. No cloud, no account, no lock-in.

## Why

- **Git-native.** Your schema source (Prisma today; Drizzle, TypeORM, SQL later) is the single source of truth. The diagram follows the repo.
- **Local-first.** Runs entirely on your machine. Nothing leaves your laptop.
- **Live.** `schemat dev` watches your schema files and pushes changes to an interactive canvas over WebSocket — edit, save, see it instantly.
- **Modular.** A small canonical IR sits between pluggable parsers and the renderer. Adding a new schema source is a new package, not a rewrite.

## Status

Early. v1 is **read-only**: the repo is the source of truth and the browser renders it. In-browser editing is a future milestone.

## Quick start

```bash
# in a project with a prisma/schema.prisma
npx @alirezahamid/schemat dev
```

Opens `http://localhost:5173` with your schema as an interactive ER diagram.

## Architecture

```
schema source ─→ [parser] ─→ IR (canonical, zod-validated) ─→ [server: watch + WebSocket] ─→ [React Flow canvas]
                                 └─→ [differ] ─→ (future) schema-drift CI checks
```

Monorepo packages:

| Package | Role |
|---|---|
| `@alirezahamid/schemat-core` | IR types, parser interface, differ. Zero parser dependencies. |
| `@alirezahamid/schemat-parser-prisma` | Prisma → IR (via `@prisma/internals` DMMF). |
| `@alirezahamid/schemat` | The `schemat` CLI: watch, serve, WebSocket. |
| `@alirezahamid/schemat-web` | Vite + React + React Flow canvas. |

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @alirezahamid/schemat dev   # run the CLI against examples/blog
```

Requires Node >= 20 and pnpm 9.

## License

MIT © Ali Reza Hamid
