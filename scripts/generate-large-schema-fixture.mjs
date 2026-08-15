/**
 * Generate a committed SQL fixture with N tables + FK chain for canvas stress.
 * Run: pnpm perf:large-schema:generate
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TABLE_COUNT = Number(process.env.SCHEMAT_PERF_TABLES ?? 120);
const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, "../examples/large-schema/schema.sql");

const lines = [
  "-- Synthetic large-schema canvas performance fixture.",
  `-- Tables: ${TABLE_COUNT}. FKs: chain (entity_i -> entity_{i-1}) + hub spokes.`,
  "-- Regenerate: pnpm perf:large-schema:generate",
  "",
];

// Hub table — many tables reference it (fan-in stress for layout).
lines.push("CREATE TABLE hub_org (");
lines.push("  id BIGINT PRIMARY KEY,");
lines.push("  name VARCHAR(255) NOT NULL,");
lines.push("  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP");
lines.push(");", "");

for (let i = 1; i <= TABLE_COUNT; i++) {
  const name = `entity_${String(i).padStart(3, "0")}`;
  const previous = `entity_${String(i - 1).padStart(3, "0")}`;
  lines.push(`CREATE TABLE ${name} (`);
  lines.push("  id BIGINT PRIMARY KEY,");
  if (i > 1) {
    lines.push(`  parent_id BIGINT NOT NULL REFERENCES ${previous}(id),`);
  }
  // Every 3rd table also FKs to hub (extra edges without exploding count).
  if (i % 3 === 0) {
    lines.push("  org_id BIGINT NOT NULL REFERENCES hub_org(id),");
  }
  lines.push("  name VARCHAR(255) NOT NULL,");
  lines.push("  status VARCHAR(32) NOT NULL DEFAULT 'active',");
  lines.push("  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,");
  lines.push("  updated_at TIMESTAMP NULL");
  lines.push(");", "");
}

// A few cross-links mid-chain so layout is not a pure path.
for (const [from, to] of [
  [40, 10],
  [80, 20],
  [100, 50],
  [120, 60],
]) {
  if (from > TABLE_COUNT || to > TABLE_COUNT) continue;
  const fromName = `entity_${String(from).padStart(3, "0")}`;
  const toName = `entity_${String(to).padStart(3, "0")}`;
  const link = `link_${String(from).padStart(3, "0")}_${String(to).padStart(3, "0")}`;
  lines.push(`CREATE TABLE ${link} (`);
  lines.push("  id BIGINT PRIMARY KEY,");
  lines.push(`  from_id BIGINT NOT NULL REFERENCES ${fromName}(id),`);
  lines.push(`  to_id BIGINT NOT NULL REFERENCES ${toName}(id),`);
  lines.push("  note VARCHAR(255) NULL");
  lines.push(");", "");
}

await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, `${lines.join("\n")}\n`);
console.log(`Generated fixture at ${target} (entity tables=${TABLE_COUNT})`);
