---
title: Canvas performance
description: Large-schema fixture and measured layout timings. Fixture plus measurement only.
---

Fixture + measurement only. No layout engine rewrite on this card.

## Fixture

| Item | Value |
| --- | --- |
| Path | `examples/large-schema/schema.sql` |
| Generator | `pnpm perf:large-schema:generate` |
| Entity tables | 120 (`entity_001`…`entity_120`) |
| Extra tables | `hub_org` + up to 4 `link_*` junctions |
| Expected total tables | ≥ 100 (typically ~125) |
| Relations | FK chain + hub spokes + cross-links |

## How to run

```bash
pnpm install
pnpm build
pnpm perf:large-schema                 # cold layout JSON
SCHEMAT_PERF_WARM=1 pnpm perf:large-schema
```

Interactive canvas:

```bash
pnpm --filter @schemat/cli exec tsx src/index.ts dev --root examples/large-schema --source sql
```

## Measured timings

From `SCHEMAT_PERF_WARM=1 pnpm perf:large-schema` on the measurement host (re-run on yours; numbers move).

| Metric | Value | Notes |
| --- | --- | --- |
| Environment | Node v20.20.2, linux arm64, 4 CPUs | measurement host; engines want Node ≥22 |
| Tables / relations | **125 / 167** | hub + 120 entities + 4 link tables |
| parseMs | **75.6** | SQL → IR |
| graphMs | **0.4** | IR → ELK node/edge list |
| coldLayoutMs | **2906.2** | first ELK `layout()` |
| warmLayoutMs | **2211.3** | second pass |

**Not measured here:** React Flow render, DOM node count, browser FPS, export SVG cost.

## Known cliffs (honest)

- **ELK layered + INTERACTIVE** is the first bottleneck. On this host cold layout is ~3s for 125 nodes / 167 edges — fine for smoke, already “noticeable” before React Flow.
- Full browser canvas will be **worse** (React Flow nodes, handles, labels, paint). Headless ~3s does **not** imply a snappy interactive canvas.
- Hub spokes + cross-links make layout harder than a pure FK path; do not compare to a bare table list.
- No production SLO. If cold layout exceeds ~10s on your machine, treat that as a real cliff — this card did not optimize it.

## What was not optimized

- No change to `layout.ts` / ELK options beyond what already ships on `main`.
- No virtualization, no graph partitioning, no worker offload.
- Smoke script fails hard only when `SCHEMAT_LAYOUT_FAIL=1` and layout exceeds `SCHEMAT_LAYOUT_BUDGET_MS` (default 30000). Default CI gate does not treat “slow” as red.

## Reproduce

```bash
pnpm perf:large-schema:generate   # optional
pnpm build && SCHEMAT_PERF_WARM=1 pnpm perf:large-schema
```
