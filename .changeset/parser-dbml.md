---
"@schemat/parser-dbml": minor
"@schemat/cli": minor
---

Add a DBML parser (`@schemat/parser-dbml`). Schemat now reads
[DBML](https://dbml.dbdiagram.io/) schemas — the format used by dbdiagram.io —
from `schema.dbml` (and other common locations), mapping tables, columns, enums,
and refs (with cardinality) into the diagram. Registered in the CLI's parser
detection, so `schemat dev/export/snapshot/check` work on DBML projects.
