# @schemat/parser-prisma

## 0.2.1

### Patch Changes

- [#42](https://github.com/alirezahamid/schemat/pull/42) [`c74d0c8`](https://github.com/alirezahamid/schemat/commit/c74d0c88a1a279b525f263726799e278e0ed4a78) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Make every CLI suggestion copy-pasteable and stop `dev` crashing on a busy port.

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

- Updated dependencies []:
  - @schemat/core@0.2.1

## 0.2.0

### Minor Changes

- [#36](https://github.com/alirezahamid/schemat/pull/36) [`1039c94`](https://github.com/alirezahamid/schemat/commit/1039c94f616692ba32a699f074891e09aa687979) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Canonical types, composite PKs, and IR fidelity.

  IR_VERSION bumps to 2: closed CanonicalType vocabulary, Column.rawType + isList, differ compares canonical type only. Prisma @@id composite PKs, SQL schema.table names, TypeORM JoinColumn/optional/type fallback.

- [#17](https://github.com/alirezahamid/schemat/pull/17) [`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Real-world Prisma robustness: parse schemas that don't statically validate but that Schemat can still render (it never connects to a database).

  - **Datasource without a static `url`** (e.g. `directUrl`-only, or url supplied at runtime) no longer errors with `Argument "url" is missing`. A harmless placeholder url is injected before validation and never used.
  - **Multi-file schemas** (`prismaSchemaFolder`: `prisma/schema/*.prisma`) are now detected and parsed — all files are concatenated.
  - **Monorepo discovery**: when no schema is found at the root, Schemat now scans `apps/*`, `packages/*`, `services/*`, `libs/*` and lists the sub-projects that contain a schema, telling you exactly which `--root` to pass.

  Verified against 7 large public schemas (cal.com 102 tables, dub 82, trigger.dev 77, langfuse 71, documenso 51, formbricks 49, umami 18).

### Patch Changes

- Updated dependencies [[`1039c94`](https://github.com/alirezahamid/schemat/commit/1039c94f616692ba32a699f074891e09aa687979), [`9d0c3d8`](https://github.com/alirezahamid/schemat/commit/9d0c3d8c09b8ea3c312f7fe7922d5ce516463dfd), [`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481)]:
  - @schemat/core@0.2.0
