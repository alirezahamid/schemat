# @schemat/parser-dbml

## 0.2.0

### Minor Changes

- [#18](https://github.com/alirezahamid/schemat/pull/18) [`95f5cff`](https://github.com/alirezahamid/schemat/commit/95f5cfff55ad964080848c1ba8574efc1213465b) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Add a DBML parser (`@schemat/parser-dbml`). Schemat now reads
  [DBML](https://dbml.dbdiagram.io/) schemas — the format used by dbdiagram.io —
  from `schema.dbml` (and other common locations), mapping tables, columns, enums,
  and refs (with cardinality) into the diagram. Registered in the CLI's parser
  detection, so `schemat dev/export/snapshot/check` work on DBML projects.

### Patch Changes

- Updated dependencies [[`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481)]:
  - @schemat/core@0.2.0
