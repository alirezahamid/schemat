# SQL dump fixture scope

These fixtures cover the durable behavior the parser IR can represent today:

- PostgreSQL two-pass `ALTER TABLE ... ADD CONSTRAINT` handling, including fully quoted schema-qualified names, quoted constraint names, composite PK/FK arrays, and safe no-ops for unknown tables/columns and malformed, unsupported ALTER statements.
- MySQL `KEY`, `INDEX`, `UNIQUE KEY`, `FULLTEXT`, and `SPATIAL` variants without treating index definitions as columns.

Intentional non-goals: preserving index names or non-unique index metadata, representing CHECK constraints, index methods/options/prefix lengths, ALTER DROP/VALIDATE/DEFERRABLE semantics, or retaining schema names. The current IR has no fields for those concepts; unsupported statements remain safe no-ops.
