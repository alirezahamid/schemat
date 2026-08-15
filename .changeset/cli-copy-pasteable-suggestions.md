---
"@schemat/cli": patch
"@schemat/render": patch
"@schemat/parser-typeorm": patch
"@schemat/parser-prisma": patch
---

Make every CLI suggestion copy-pasteable and stop `dev` crashing on a busy port.

- Suggestions now carry the subcommand you ran and the `--root` you passed, so
  the monorepo hint prints `schemat dev --root apps/identity-service` instead of
  a bare `schemat --root …` that fails with `unknown option '--root'`.
- `schemat dev` reports a clean, actionable message when the port is in use
  instead of dumping a raw Node stack trace, and `--port 0` now prints the port
  the OS actually assigned.
- `schemat init` parses before writing `schemat.config.json`, so a failed init
  no longer leaves behind a config that breaks later commands.
- Monorepo suggestions sort naturally (`svc2` before `svc10`) and truncate after
  10 entries.
- TypeORM detection now recognises entities whose decorators are re-exported
  through a shared barrel, and services in a workspace where `typeorm` is
  hoisted to the root `package.json`.
- The `--root` you pass is validated up front, so a typo reports the bad path
  instead of the misleading "no schema found".
- `schemat dev` rejects a non-numeric `--port` with a message naming the flag,
  and Prisma parse failures name the schema that failed before the raw `P1012`
  text.
- `schemat export` prints an absolute output path when the relative one would
  climb out of the working directory.
