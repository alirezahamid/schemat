---
"@schemat/core": minor
"@schemat/cli": minor
"@schemat/parser-prisma": minor
"@schemat/parser-sql": minor
"@schemat/render": minor
"@schemat/web": minor
"@schemat/parser-typeorm": minor
"@schemat/parser-drizzle": minor
"@schemat/parser-dbml": minor
"@schemat/parser-mikroorm": minor
"@schemat/parser-mongoose": minor
---

Canonical types, composite PKs, and IR fidelity.

IR_VERSION bumps to 2: closed CanonicalType vocabulary, Column.rawType + isList, differ compares canonical type only. Prisma @@id composite PKs, SQL schema.table names, TypeORM JoinColumn/optional/type fallback.
