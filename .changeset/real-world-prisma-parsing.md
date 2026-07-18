---
"@schemat/cli": minor
"@schemat/core": minor
"@schemat/parser-prisma": minor
"@schemat/parser-sql": minor
"@schemat/render": minor
"@schemat/web": minor
---

Real-world Prisma robustness: parse schemas that don't statically validate but that Schemat can still render (it never connects to a database).

- **Datasource without a static `url`** (e.g. `directUrl`-only, or url supplied at runtime) no longer errors with `Argument "url" is missing`. A harmless placeholder url is injected before validation and never used.
- **Multi-file schemas** (`prismaSchemaFolder`: `prisma/schema/*.prisma`) are now detected and parsed — all files are concatenated.
- **Monorepo discovery**: when no schema is found at the root, Schemat now scans `apps/*`, `packages/*`, `services/*`, `libs/*` and lists the sub-projects that contain a schema, telling you exactly which `--root` to pass.

Verified against 7 large public schemas (cal.com 102 tables, dub 82, trigger.dev 77, langfuse 71, documenso 51, formbricks 49, umami 18).
