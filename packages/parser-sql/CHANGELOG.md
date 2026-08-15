# @schemat/parser-sql

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

- [#34](https://github.com/alirezahamid/schemat/pull/34) [`bffb37e`](https://github.com/alirezahamid/schemat/commit/bffb37e090d1d44a773ae361bed554bedaa4c32b) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Add `--source` CLI flag, `schemat.config.json` / `.schematrc.json` config, and
  `schemat init`. Detection order is now specific sources first (prisma, drizzle,
  typeorm, mikroorm, mongoose, dbml) with SQL last; loose root `*.sql` only
  detects when the file contains CREATE TABLE. Precedence: CLI `--source` >
  config `source` > auto-detect.
- Updated dependencies [[`1039c94`](https://github.com/alirezahamid/schemat/commit/1039c94f616692ba32a699f074891e09aa687979), [`9d0c3d8`](https://github.com/alirezahamid/schemat/commit/9d0c3d8c09b8ea3c312f7fe7922d5ce516463dfd), [`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481)]:
  - @schemat/core@0.2.0
