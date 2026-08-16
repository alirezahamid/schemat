---
title: Quick start
description: Initialise Schemat in a repo, then run the live diagram and the CI drift gate.
---

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

## `schemat init`

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
