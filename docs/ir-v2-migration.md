# IR v2 migration — canonical types and column fidelity

## What changed

`IR_VERSION` is now **2**. Snapshots written under v1 must be regenerated
(`schemat snapshot`).

### Column shape

| Field | v1 | v2 |
| --- | --- | --- |
| `type` | free-form string (`String`, `varchar`, `number`, …) | closed `CanonicalType` enum |
| `rawType` | absent | source type string for display |
| `isList` | absent | `true` for array / list columns |

### CanonicalType vocabulary

`string | int | bigint | float | decimal | boolean | datetime | date | time |
json | bytes | uuid | enum | object | array | unknown`

Parsers map dialect types via `mapToCanonicalType()` from `@schemat/core`.
The differ uses `type` (+ flags), never `rawType`, so Prisma `String` vs SQL
`varchar` no longer reports as `column.changed`.

### Other fidelity fixes (same release)

- Prisma `@@id([a,b])` marks all listed columns as primary keys.
- Prisma scalar lists (`String[]`) set `isList: true`.
- SQL keeps non-`public` schema qualifiers (`auth.users` ≠ `users`).
- TypeORM honors `@JoinColumn({ name })`, TS `prop?:` nullability, and never
  leaks raw TS type text into `type`.

## Migration steps

1. Upgrade packages that depend on `@schemat/core`.
2. Re-run `schemat snapshot` (or delete `.schemat/snapshot.json` and re-check).
3. Any hand-written IR fixtures need `version: 2`, `rawType`, and `isList`.
