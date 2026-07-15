#!/usr/bin/env node
import { Command } from "commander";
import { runCheck } from "./commands/check";
import { runDev } from "./commands/dev";
import { runDiff } from "./commands/diff";
import { type ExportFormat, runExport } from "./commands/export";
import { runSnapshot } from "./commands/snapshot";

const program = new Command();

program
  .name("schemat")
  .description("Git-native database schema documentation — live interactive ER diagrams.")
  .version("0.0.0");

program
  .command("dev")
  .description("Serve an interactive, live-reloading ER diagram for the project's schema.")
  .option("-r, --root <dir>", "project root containing the schema", ".")
  .option("-p, --port <number>", "port to serve on", "5173")
  .action(async (opts: { root: string; port: string }) => {
    await runDev({ root: opts.root, port: Number.parseInt(opts.port, 10) });
  });

program
  .command("export")
  .description("Export a static ER diagram (SVG or Mermaid) — commit it to your repo.")
  .option("-r, --root <dir>", "project root containing the schema", ".")
  .option("-f, --format <format>", "output format: svg | mermaid", "svg")
  .option("-o, --out <file>", "output file path (default: <root>/schema.<ext>)")
  .action(async (opts: { root: string; format: string; out?: string }) => {
    await runExport({
      root: opts.root,
      format: opts.format as ExportFormat,
      out: opts.out,
    });
  });

program
  .command("snapshot")
  .description("Write the current schema to .schemat/schema.snapshot.json (commit it for drift checks).")
  .option("-r, --root <dir>", "project root containing the schema", ".")
  .action(async (opts: { root: string }) => {
    await runSnapshot({ root: opts.root });
  });

program
  .command("check")
  .description("Fail if the live schema drifted from the committed snapshot (for CI).")
  .option("-r, --root <dir>", "project root containing the schema", ".")
  .option("-f, --format <format>", "output format: text | markdown", "text")
  .action(async (opts: { root: string; format: string }) => {
    await runCheck({
      root: opts.root,
      format: opts.format === "markdown" ? "markdown" : "text",
    });
  });

program
  .command("diff")
  .description("Structural diff between two schema sources (dirs or .prisma/.sql files).")
  .argument("<before>", "the baseline schema (project dir or schema file)")
  .argument("<after>", "the compared schema (project dir or schema file)")
  .option("-f, --format <format>", "output format: text | markdown | json", "text")
  .action(async (before: string, after: string, opts: { format: string }) => {
    const format =
      opts.format === "json" ? "json" : opts.format === "markdown" ? "markdown" : "text";
    await runDiff({ before, after, format });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
