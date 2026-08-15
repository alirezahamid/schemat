#!/usr/bin/env node
import { Command } from "commander";
import { runCheck } from "./commands/check";
import { runDev } from "./commands/dev";
import { runDiff } from "./commands/diff";
import { type ExportFormat, runExport } from "./commands/export";
import { runInit } from "./commands/init";
import { runSnapshot } from "./commands/snapshot";
import { PARSER_NAMES } from "./schema-source";

// Injected at build time by tsup (see tsup.config.ts). Falls back to "0.0.0"
// only if the CLI is run un-bundled (e.g. via tsx during development).
declare const __CLI_VERSION__: string;
const VERSION = typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "0.0.0";

const SOURCE_HELP = `schema source override: ${PARSER_NAMES.join(" | ")}`;

const program = new Command();

program
  .name("schemat")
  .description("Git-native database schema documentation — live interactive ER diagrams.")
  .version(VERSION);

program
  .command("init")
  .description("Detect the schema source, write schemat.config.json, and take an initial snapshot.")
  .option("-r, --root <dir>", "project root containing the schema", ".")
  .option("-s, --source <parser>", SOURCE_HELP)
  .option("-f, --force", "overwrite an existing schemat.config.json", false)
  .action(async (opts: { root: string; source?: string; force?: boolean }) => {
    await runInit({ root: opts.root, source: opts.source, force: opts.force });
  });

program
  .command("dev")
  .description("Serve an interactive, live-reloading ER diagram for the project's schema.")
  .option("-r, --root <dir>", "project root containing the schema", ".")
  .option("-p, --port <number>", "port to serve on", "5173")
  .option("-s, --source <parser>", SOURCE_HELP)
  .action(async (opts: { root: string; port: string; source?: string }) => {
    await runDev({
      root: opts.root,
      port: Number.parseInt(opts.port, 10),
      source: opts.source,
    });
  });

program
  .command("export")
  .description("Export a static ER diagram (SVG or Mermaid) — commit it to your repo.")
  .option("-r, --root <dir>", "project root containing the schema", ".")
  .option("-f, --format <format>", "output format: svg | mermaid", "svg")
  .option("-o, --out <file>", "output file path (default: <root>/schema.<ext>)")
  .option("-s, --source <parser>", SOURCE_HELP)
  .action(async (opts: { root: string; format: string; out?: string; source?: string }) => {
    await runExport({
      root: opts.root,
      format: opts.format as ExportFormat,
      out: opts.out,
      source: opts.source,
    });
  });

program
  .command("snapshot")
  .description(
    "Write the current schema to .schemat/schema.snapshot.json (commit it for drift checks).",
  )
  .option("-r, --root <dir>", "project root containing the schema", ".")
  .option("-s, --source <parser>", SOURCE_HELP)
  .action(async (opts: { root: string; source?: string }) => {
    await runSnapshot({ root: opts.root, source: opts.source });
  });

program
  .command("check")
  .description("Fail if the live schema drifted from the committed snapshot (for CI).")
  .option("-r, --root <dir>", "project root containing the schema", ".")
  .option("-f, --format <format>", "output format: text | markdown", "text")
  .option("-s, --source <parser>", SOURCE_HELP)
  .action(async (opts: { root: string; format: string; source?: string }) => {
    await runCheck({
      root: opts.root,
      format: opts.format === "markdown" ? "markdown" : "text",
      source: opts.source,
    });
  });

program
  .command("diff")
  .description("Structural diff between two schema sources (dirs or .prisma/.sql files).")
  .argument("<before>", "the baseline schema (project dir or schema file)")
  .argument("<after>", "the compared schema (project dir or schema file)")
  .option("-f, --format <format>", "output format: text | markdown | json", "text")
  .option("-s, --source <parser>", SOURCE_HELP)
  .action(async (before: string, after: string, opts: { format: string; source?: string }) => {
    const format =
      opts.format === "json" ? "json" : opts.format === "markdown" ? "markdown" : "text";
    await runDiff({ before, after, format, source: opts.source });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
