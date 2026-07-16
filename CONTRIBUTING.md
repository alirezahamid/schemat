# Contributing to Schemat

Thanks for helping build Schemat! This guide gets you from clone to merged PR.

## Prerequisites

- **Node 22+** (the web build needs it; Node 20 is too old)
- **pnpm 9** — `corepack enable` then `corepack prepare pnpm@9.15.0 --activate`

## Setup

```bash
git clone https://github.com/alirezahamid/schemat.git
cd schemat
pnpm install
pnpm build
```

Run the CLI against a bundled example:

```bash
pnpm dev            # serves examples/blog on http://localhost:5173
```

## Monorepo layout

| Package | npm | What it does |
| --- | --- | --- |
| `packages/core` | `@schemat/core` | Schema IR types, parser interface, structural differ. Zero parser deps. |
| `packages/parser-prisma` | `@schemat/parser-prisma` | Prisma → IR via `@prisma/internals` DMMF. |
| `packages/parser-sql` | `@schemat/parser-sql` | SQL DDL → IR. |
| `packages/render` | `@schemat/render` | Headless SVG + Mermaid export and diff rendering. |
| `packages/web` | `@schemat/web` | Vite + React + React Flow canvas (bundled into the CLI). |
| `packages/cli` | `@schemat/cli` | The `schemat` CLI: dev / export / snapshot / check / diff. |

## Development workflow

```bash
pnpm lint         # Biome
pnpm typecheck    # tsc --noEmit across all packages
pnpm test         # unit tests across all packages
pnpm build        # build everything

# scope to one package:
pnpm --filter @schemat/render test
pnpm --filter @schemat/core typecheck
```

## Commit convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` a new feature
- `fix:` a bug fix
- `docs:` documentation only
- `refactor:` / `chore:` / `test:` — no user-facing behavior change

## Changesets — REQUIRED for user-facing changes

Schemat publishes with [Changesets](https://github.com/changesets/changesets).
**Any change that affects published behavior needs a changeset.** After your edit:

```bash
pnpm changeset
```

Select the affected packages and a bump level:

- **patch** — bug fix, no API change
- **minor** — new backwards-compatible feature
- **major** — breaking change

Write a one-line summary — it becomes the changelog entry. Commit the generated
`.changeset/*.md` file with your code.

> All Schemat packages are **fixed-versioned** (they bump and release together),
> so you only choose the bump level once even if you touched several packages.

Docs-only or internal-only changes don't need one — CI won't block you, and you
can run `pnpm changeset --empty` if you want an explicit "no release" marker.

## Opening a PR

1. Branch off `main`: `git checkout -b feat/my-thing`
2. Make your change + add tests.
3. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all green.
4. `pnpm changeset` if user-facing.
5. Push and open a PR. Fill in the template checklist.

CI runs lint, typecheck, test, and build on every PR. A maintainer reviews and
merges; releases are cut separately (see [`RELEASING.md`](./RELEASING.md)).

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). Be kind.
