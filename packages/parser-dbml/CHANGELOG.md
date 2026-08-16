# @schemat/parser-dbml

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @schemat/core@0.2.1

## 0.2.0

### Minor Changes

- [#36](https://github.com/alirezahamid/schemat/pull/36) [`1039c94`](https://github.com/alirezahamid/schemat/commit/1039c94f616692ba32a699f074891e09aa687979) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Canonical types, composite PKs, and IR fidelity.

  IR_VERSION bumps to 2: closed CanonicalType vocabulary, Column.rawType + isList, differ compares canonical type only. Prisma @@id composite PKs, SQL schema.table names, TypeORM JoinColumn/optional/type fallback.

- [#18](https://github.com/alirezahamid/schemat/pull/18) [`95f5cff`](https://github.com/alirezahamid/schemat/commit/95f5cfff55ad964080848c1ba8574efc1213465b) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Add a DBML parser (`@schemat/parser-dbml`). Schemat now reads
  [DBML](https://dbml.dbdiagram.io/) schemas — the format used by dbdiagram.io —
  from `schema.dbml` (and other common locations), mapping tables, columns, enums,
  and refs (with cardinality) into the diagram. Registered in the CLI's parser
  detection, so `schemat dev/export/snapshot/check` work on DBML projects.

### Patch Changes

- Updated dependencies [[`1039c94`](https://github.com/alirezahamid/schemat/commit/1039c94f616692ba32a699f074891e09aa687979), [`9d0c3d8`](https://github.com/alirezahamid/schemat/commit/9d0c3d8c09b8ea3c312f7fe7922d5ce516463dfd), [`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481)]:
  - @schemat/core@0.2.0
