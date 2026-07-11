# Schemat — Implementation Plan

**Goal:** Open-source, git-native database schema documentation tool. Point it at a repo, run `npx schemat dev`, get a live-reloading interactive ER diagram in the browser. dbdiagram.io UX, but local-first and git-native.

**Architecture:** Compiler-style pipeline — pluggable **parsers** turn schema sources (Prisma first) into a canonical **IR**, a local **server** watches files and pushes IR over WebSocket, a **browser canvas** (React Flow) renders it interactively. Read-only in v1: repo is source of truth, browser is the view.

**Tech Stack:** TypeScript everywhere · pnpm monorepo · Node CLI (commander + chokidar + ws) · Vite + React + React Flow + elkjs · zod for IR validation · vitest for tests · tsup for builds.

**Design principles (non-negotiable per Allen):** simplicity over cleverness, no over-engineering (YAGNI), high performance, maintainability, and a modular seam (the parser interface) that makes it futuristic & scalable — add Drizzle/TypeORM/SQL later without touching core.

---

## Why these tech choices (tradeoffs locked)

- **TypeScript, not Rust/Go:** target parsers (Drizzle, Prisma tooling) are TS-native; reuse their AST/DMMF instead of re-parsing. Ship faster, bigger contributor pool. Add a compiled binary later only if CI speed demands.
- **pnpm workspaces monorepo:** clean package boundaries (`core` has zero deps on parsers), fast installs, easy to publish packages independently. Not Nx/Turbo yet — YAGNI; add Turbo only when build times hurt.
- **React Flow, not raw SVG:** node-graph editor with pan/zoom/drag/selection built-in. Saves weeks. Tables = custom nodes, FKs = edges. elkjs for auto-layout.
- **WebSocket, not polling:** instant live-reload is the magic moment. `ws` is tiny and battle-tested.
- **zod for the IR:** one schema definition gives runtime validation + inferred TS types. Parsers must produce IR that passes zod — this is the contract that keeps parsers honest.
- **Read-only v1:** editing-in-browser + round-tripping back into Prisma syntax is a v2 mountain (formatting/comments/ordering). Live-reload-from-repo is already delightful at 5x less effort.

---

## Monorepo layout

```
schemat/
├─ package.json            # pnpm workspace root, scripts
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ packages/
│  ├─ core/                # IR types (zod), parser interface, differ. ZERO parser deps.
│  ├─ parser-prisma/       # first parser: Prisma → IR via @prisma/internals DMMF
│  ├─ cli/                 # `schemat` binary: commander + chokidar watch + ws server + serves web
│  └─ web/                 # Vite + React + React Flow canvas
└─ examples/
   └─ blog/schema.prisma   # sample schema for dev + tests
```

**Dependency rule:** `core` depends on nothing internal. `parser-prisma` depends on `core`. `cli` depends on `core` + `parser-prisma`. `web` depends on `core` (types only). This is the seam that makes it scalable — new parsers are new packages, nothing else changes.

---

## The IR (design first — everything hangs off this)

`packages/core/src/ir.ts` — zod schemas + inferred types.

```ts
import { z } from "zod";

export const Column = z.object({
  name: z.string(),
  type: z.string(),          // canonical type string, e.g. "string", "int", "datetime"
  nullable: z.boolean(),
  isPrimaryKey: z.boolean(),
  isUnique: z.boolean(),
  default: z.string().nullable(),   // rendered default, null if none
  comment: z.string().nullable(),
});

export const Relation = z.object({
  name: z.string(),               // stable id for the edge
  fromTable: z.string(),
  fromColumns: z.array(z.string()),
  toTable: z.string(),
  toColumns: z.array(z.string()),
  cardinality: z.enum(["one-to-one", "one-to-many", "many-to-many"]),
});

export const Table = z.object({
  name: z.string(),
  columns: z.array(Column),
  comment: z.string().nullable(),
});

export const Enum = z.object({
  name: z.string(),
  values: z.array(z.string()),
});

export const IRSchema = z.object({
  version: z.literal(1),           // IR schema version — future migrations
  tables: z.array(Table),
  enums: z.array(Enum),
  relations: z.array(Relation),
});

export type IRSchema = z.infer<typeof IRSchema>;
```

**Why versioned IR:** `version: 1` lets the IR evolve without breaking cached layouts or older parsers. Cheap now, saves pain later. This is the "scalable" hedge — not speculative, just a version field.

`packages/core/src/parser.ts` — the modular seam:

```ts
import type { IRSchema } from "./ir";

export interface ParserInput {
  projectPath: string;       // repo root
  files?: string[];          // resolved schema files, if known
}

export interface SchemaParser {
  name: string;                                   // "prisma"
  detect(projectPath: string): Promise<boolean>;  // auto-detect this source in a repo
  parse(input: ParserInput): Promise<IRSchema>;   // → canonical IR (must pass IRSchema.parse)
}
```

`packages/core/src/differ.ts` — structured diff (powers future CI drift-detection, and the "what changed" UI):

```ts
import type { IRSchema } from "./ir";

export type SchemaChange =
  | { kind: "table.added"; table: string }
  | { kind: "table.removed"; table: string }
  | { kind: "column.added"; table: string; column: string }
  | { kind: "column.removed"; table: string; column: string }
  | { kind: "column.changed"; table: string; column: string; before: string; after: string }
  | { kind: "relation.added"; name: string }
  | { kind: "relation.removed"; name: string };

export function diff(before: IRSchema, after: IRSchema): SchemaChange[];
```

---

## Phased build (each phase ships something runnable)

### Phase 0 — Walking skeleton (the proof)
**Outcome:** `pnpm dev` in the repo → browser opens → the example Prisma schema renders as a static ER diagram from real IR.

- Scaffold pnpm monorepo, tsconfig base, vitest, tsup, biome (lint/format — one tool, not eslint+prettier; simplicity).
- `core`: IR zod schemas + `SchemaParser` interface + empty `differ` signature. Unit test: a hand-built IR object passes `IRSchema.parse`.
- `parser-prisma`: implement `parse()` using `@prisma/internals` `getDMMF()`, map DMMF → IR. Test against `examples/blog/schema.prisma` — assert table/column/relation counts.
- `web`: Vite + React + React Flow. Hardcode-load a sample IR JSON, map tables→nodes, relations→edges, elkjs auto-layout. Renders, pans, zooms.
- `cli`: `schemat dev` command — run prisma parser on cwd, serve `web` build, inject IR as JSON.
- **Verify:** `npx schemat dev` in `examples/blog` shows the real schema in browser. Screenshot proof.

### Phase 1 — Live reload (the magic moment)
**Outcome:** edit `schema.prisma` in your editor → diagram updates in the browser instantly, no refresh.

- `cli`: add `chokidar` watch on detected schema files → re-parse → push IR over `ws`.
- `web`: WebSocket client → on new IR, reconcile nodes/edges. Preserve existing node positions, auto-layout only new tables.
- Debounce re-parse (chokidar fires multiple events). 
- **Verify:** live-edit a column, watch it appear. Screen recording / before-after screenshots.

### Phase 2 — Layout persistence (git-native positions)
**Outcome:** drag tables to arrange them; positions saved to repo; survive restart.

- `web`: on node drag-end, POST positions to CLI.
- `cli`: persist to `.schemat/layout.json` (pretty-printed, git-friendly, stable key order for clean diffs).
- On load: merge saved positions with auto-layout for new/unpositioned tables.
- **Verify:** arrange, restart `schemat dev`, layout restored. `git diff` on layout.json is clean/minimal.

### Phase 3 — Polish the canvas (dbdiagram-quality view)
**Outcome:** it looks and feels good enough to show off.

- Table nodes: header (name), rows (col name · type · badges for PK/FK/unique/nullable).
- FK edges: connect column-to-column, hover highlights related tables, dim the rest.
- Search/filter tables; fit-to-view; minimap; light/dark theme.
- Enums rendered as their own node type.
- **Verify:** render a realistic 15+ table schema; interactions smooth (60fps target).

### Phase 4 — Static export (GitHub-native value)
**Outcome:** `schemat export` writes a committable diagram for READMEs/PRs.

- `schemat export --format svg` (self-contained SVG) and `--format mermaid` (GitHub renders inline).
- Reuse layout.json positions for deterministic output.
- **Verify:** exported SVG opens standalone; Mermaid renders on GitHub.

### Phase 5 (deferred, documented not built) — the moat
- Second parser (Drizzle or SQL DDL) — proves the modular seam.
- `schemat diff <ref>` + GitHub Action using `core/differ` for schema-drift CI checks.
- These are explicitly **out of v1 scope** — noted so the architecture supports them, per YAGNI we don't build them yet.

---

## Files created (Phase 0–1 core set)

- `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, `biome.json`
- `packages/core/src/{ir.ts,parser.ts,differ.ts,index.ts}` + `packages/core/test/ir.test.ts`
- `packages/parser-prisma/src/index.ts` + `packages/parser-prisma/test/prisma.test.ts`
- `packages/cli/src/{index.ts,commands/dev.ts,server.ts,watch.ts}` + `packages/cli/package.json` (bin: `schemat`)
- `packages/web/src/{main.tsx,App.tsx,canvas/TableNode.tsx,canvas/graph.ts,ws.ts,layout.ts}` + `vite.config.ts`
- `examples/blog/schema.prisma`

## Validation strategy

- **Unit (vitest):** IR validation, Prisma→IR mapping counts, differ correctness.
- **Integration:** spin CLI against `examples/blog`, assert served IR JSON matches expected shape.
- **Manual/visual:** browser render verified via screenshot at each phase (verify-and-run skill).
- **Review:** every phase goes through build→codex-review→fix→verify before "done" (build-and-review-loop skill). Not a throwaway prototype.

## Risks & tradeoffs

- **`@prisma/internals` is a heavy dep, tied to Prisma versions.** Accepted for v1 (cleanest input). Isolated in `parser-prisma` — swappable, doesn't touch core.
- **React Flow layout can fight big schemas.** Mitigation: elkjs layered layout, virtualize if >200 tables (defer until needed — YAGNI).
- **Live-reload reconciliation** (preserving positions across re-parse) is the trickiest bit. Keyed by table name; new tables auto-layout.
- **Read-only limitation** may disappoint dbdiagram users expecting in-browser editing. Explicitly a v2 decision; documented in README.

## Open questions for Allen

1. **Package/repo name:** LOCKED. npm bare `schemat` taken (v2.0.1) → use scoped **`@alirezahamid/schemat`** (free, owned by Allen's scope). GitHub repo `schemat` under `alirezahamid`. CLI binary `schemat`. Future packages: `@alirezahamid/schemat-core`, `@alirezahamid/schemat-parser-prisma`.
2. **Bundle:** monorepo now, or keep `web` as a separate published artifact later? Plan assumes single repo, `web` built into the CLI package.
3. **First-parser confirm:** Prisma for v1 (assumed). Swap if your daily driver is Drizzle.
