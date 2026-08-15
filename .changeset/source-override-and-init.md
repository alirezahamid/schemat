---
"@schemat/cli": minor
"@schemat/parser-sql": patch
---

Add `--source` CLI flag, `schemat.config.json` / `.schematrc.json` config, and
`schemat init`. Detection order is now specific sources first (prisma, drizzle,
typeorm, mikroorm, mongoose, dbml) with SQL last; loose root `*.sql` only
detects when the file contains CREATE TABLE. Precedence: CLI `--source` >
config `source` > auto-detect.
