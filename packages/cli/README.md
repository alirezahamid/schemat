# @schemat/cli

The `schemat` command — git-native database schema documentation with live,
interactive ER diagrams. Part of [Schemat](https://github.com/alirezahamid/schemat).

## Install

```bash
npm i -g @schemat/cli    # then: schemat <command>
# or one-off:
npx @schemat/cli dev
```

## Commands

All commands take `-r, --root <dir>` (defaults to `.`). Point it at a project
containing `prisma/schema.prisma` (or a SQL schema).

### `schemat dev`

Serve a live, auto-reloading ER diagram.

```bash
schemat dev -r . -p 5173
```

Opens `http://localhost:5173`. Edit your schema file and the canvas reloads.

### `schemat export`

Write a static diagram you can commit.

```bash
schemat export -f svg                 # -> schema.svg
schemat export -f mermaid -o db.mmd   # -> db.mmd (Mermaid erDiagram)
```

### `schemat snapshot`

Freeze the current schema for drift checks.

```bash
schemat snapshot        # -> .schemat/schema.snapshot.json (commit this)
```

### `schemat check`

Fail (exit 1) if the live schema drifted from the committed snapshot. For CI.

```bash
schemat check                 # text output
schemat check -f markdown     # PR-comment format
```

> Don't pipe `check` through `tail`/`head` in CI — that masks the exit code.

### `schemat diff`

Structural diff between two schema sources (dirs or `.prisma` / `.sql` files).

```bash
schemat diff before.prisma after.prisma
schemat diff before/ after/ -f json
```

## CI

Use the bundled GitHub Action to gate PRs on schema drift — see the
[main README](https://github.com/alirezahamid/schemat#drift-check-in-ci).

## License

MIT © Ali Reza Hamid
