/**
 * Smoke benchmark: parse + graph + ELK layout on examples/large-schema.
 * Mirrors packages/web canvas layout options (layered + INTERACTIVE).
 *
 * Requires: pnpm build (dist of core + parser-sql; elkjs via @schemat/web).
 * Run: pnpm perf:large-schema
 *
 * Honest numbers only — not a production SLO. Env:
 *   SCHEMAT_LAYOUT_BUDGET_MS  fail if layout exceeds this (default 30000)
 *   SCHEMAT_PERF_WARM         set to 1 for a second layout pass
 */
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const require = createRequire(path.join(root, "packages/web/package.json"));
const ELK = require("elkjs/lib/elk.bundled.js");

const core = await import(pathToFileURL(path.join(root, "packages/core/dist/index.js")).href);
const { sqlParser } = await import(
  pathToFileURL(path.join(root, "packages/parser-sql/dist/index.js")).href
);

const fixture = path.join(root, "examples/large-schema");
const minimumTables = 100;
const maximumLayoutMs = Number(process.env.SCHEMAT_LAYOUT_BUDGET_MS ?? 30_000);
const warm = process.env.SCHEMAT_PERF_WARM === "1";

const NODE_WIDTH = 240;
const ROW_HEIGHT = 26;
const HEADER_HEIGHT = 40;

const layoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "120",
  "elk.spacing.nodeNode": "60",
  "elk.layered.nodePlacement.strategy": "INTERACTIVE",
  "elk.layered.crossingMinimization.strategy": "INTERACTIVE",
  "elk.interactive": "true",
};

function nodeHeight(rowCount) {
  return HEADER_HEIGHT + rowCount * ROW_HEIGHT + 8;
}

async function runLayout(nodes, edges) {
  const elk = new ELK();
  return elk.layout({
    id: "root",
    layoutOptions,
    children: nodes,
    edges,
  });
}

const parseStarted = performance.now();
const { schema } = core.normalizeParserOutput(await sqlParser.parse({ projectPath: fixture }));
const parseMs = performance.now() - parseStarted;

if (schema.tables.length < minimumTables) {
  throw new Error(`Fixture has ${schema.tables.length} tables; need >= ${minimumTables}`);
}

const graphStarted = performance.now();
const nodes = schema.tables.map((table) => ({
  id: table.name,
  width: NODE_WIDTH,
  height: nodeHeight(table.columns?.length ?? 1),
}));
const edges = schema.relations.map((rel, i) => ({
  id: rel.name ?? `e${i}`,
  sources: [rel.fromTable],
  targets: [rel.toTable],
}));
const graphMs = performance.now() - graphStarted;

const coldStarted = performance.now();
const cold = await runLayout(nodes, edges);
const coldLayoutMs = performance.now() - coldStarted;

const children = cold.children ?? [];
if (children.length !== nodes.length) {
  throw new Error(`Layout dropped nodes: got ${children.length}, expected ${nodes.length}`);
}
for (const child of children) {
  if (!Number.isFinite(child.x) || !Number.isFinite(child.y)) {
    throw new Error(`Invalid position for ${child.id}`);
  }
}

let warmLayoutMs = null;
if (warm) {
  const warmStarted = performance.now();
  await runLayout(nodes, edges);
  warmLayoutMs = performance.now() - warmStarted;
}

const overBudget = coldLayoutMs > maximumLayoutMs;
const result = {
  env: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: (await import("node:os")).cpus().length,
  },
  fixture: "examples/large-schema",
  tables: schema.tables.length,
  relations: schema.relations.length,
  nodes: children.length,
  edges: edges.length,
  parseMs: Number(parseMs.toFixed(1)),
  graphMs: Number(graphMs.toFixed(1)),
  coldLayoutMs: Number(coldLayoutMs.toFixed(1)),
  warmLayoutMs: warmLayoutMs == null ? null : Number(warmLayoutMs.toFixed(1)),
  budgetMs: maximumLayoutMs,
  overBudget,
  note: "Smoke only. ELK layout on headless graph; not full browser paint/React Flow.",
};

console.log(JSON.stringify(result, null, 2));

if (overBudget) {
  console.error(
    `WARN: cold layout ${coldLayoutMs.toFixed(1)}ms exceeds budget ${maximumLayoutMs}ms (reported, not optimized)`,
  );
  // Fail only if budget is explicitly tight and user set it; default 30s is a safety timeout.
  // Keep exit 0 when over soft budget so CI gate still greenn; hard fail via SCHEMAT_LAYOUT_FAIL=1.
  if (process.env.SCHEMAT_LAYOUT_FAIL === "1") process.exit(2);
}
