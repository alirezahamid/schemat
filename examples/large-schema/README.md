# Large-schema canvas fixture

Synthetic SQL schema used to stress the canvas layout path (parse → graph → ELK).

## Location

- `examples/large-schema/schema.sql` — committed fixture (≥100 tables + FKs)
- `scripts/generate-large-schema-fixture.mjs` — regenerator

## Shape

- `hub_org` + `entity_001`…`entity_N` (default N=120)
- FK chain: `entity_i.parent_id → entity_{i-1}.id`
- Hub spokes: every 3rd entity FKs `hub_org`
- A few `link_*` junction tables for mid-graph cross edges

Not a real product schema. Purpose is layout density only.

## Commands

From repo root (after `pnpm install` + `pnpm build`):

```bash
# regenerate committed SQL (optional; already checked in)
pnpm perf:large-schema:generate

# parse + headless ELK layout smoke (JSON timings on stdout)
pnpm perf:large-schema

# second layout pass after cold
SCHEMAT_PERF_WARM=1 pnpm perf:large-schema
```

Load in the interactive canvas (same path as any SQL project):

```bash
pnpm --filter @schemat/cli exec tsx src/index.ts dev --root examples/large-schema --source sql
# or, after a full build of the CLI:
# pnpm --filter @schemat/cli start   # if wired
# schemat dev --root examples/large-schema --source sql
```

## Smoke vs full UI

`pnpm perf:large-schema` measures **parse + pure ELK layout** with the same layout options as `packages/web/src/canvas/layout.ts`. It does **not** measure React Flow mount, browser paint, or WebSocket fan-out. Treat numbers as a layout smoke signal only — not an SLO.

See [docs/perf-canvas.md](../../docs/perf-canvas.md) for measured numbers and known cliffs.
